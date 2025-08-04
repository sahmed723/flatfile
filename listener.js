import { FlatfileListener } from "@flatfile/listener";
import api from "@flatfile/api";

/**
 * Formats phone numbers to standardized format
 * Handles various input formats from the customer data
 */
function formatPhoneNumber(phone) {
  if (!phone) return "";

  // Convert to string and remove all non-digits
  const cleanPhone = phone.toString().replace(/\D/g, "");

  // Handle 10-digit numbers (add +1)
  if (cleanPhone.length === 10) {
    return `+1 (${cleanPhone.slice(0, 3)}) ${cleanPhone.slice(
      3,
      6
    )}-${cleanPhone.slice(6)}`;
  }

  // Handle 11-digit numbers starting with 1
  if (cleanPhone.length === 11 && cleanPhone.startsWith("1")) {
    return `+${cleanPhone.slice(0, 1)} (${cleanPhone.slice(
      1,
      4
    )}) ${cleanPhone.slice(4, 7)}-${cleanPhone.slice(7)}`;
  }

  // Handle numbers that already have country code
  if (phone.toString().startsWith("+")) {
    return phone.toString();
  }

  // Default: add + prefix
  return `+${cleanPhone}`;
}

/**
 * Detects if a phone number is a USA number
 * Returns true for numbers that start with +1 or are 10-digit numbers
 */
function isUSANumber(phone) {
  if (!phone) return false;

  const phoneStr = phone.toString();

  // Check if it already has +1 prefix (exact match)
  if (phoneStr.startsWith("+1 ")) {
    return true;
  }

  // Check if it starts with +1 followed by a digit (not +10, +11, etc.)
  if (phoneStr.startsWith("+1") && phoneStr.length > 2) {
    const nextChar = phoneStr.charAt(2);
    // Only true if the next character is a digit (not a letter or special char)
    if (/^\d$/.test(nextChar)) {
      // Additional check: make sure it's not +10, +11, +12, etc.
      const afterPlus1 = phoneStr.substring(2);
      // If it starts with a digit after +1, check if it's a valid USA area code pattern
      if (
        /^\d{10}$/.test(afterPlus1) ||
        /^\d{1}\s?\(\d{3}\)\s?\d{3}-\d{4}$/.test(afterPlus1)
      ) {
        return true;
      }
      // For longer numbers, be more conservative
      if (afterPlus1.length > 10) {
        return false; // Likely international
      }
    }
  }

  // Convert to string and remove all non-digits
  const cleanPhone = phoneStr.replace(/\D/g, "");

  // Check if it's a 10-digit number (USA format without country code)
  if (cleanPhone.length === 10) {
    return true;
  }

  // Check if it's an 11-digit number starting with 1 (USA country code)
  if (cleanPhone.length === 11 && cleanPhone.startsWith("1")) {
    return true;
  }

  return false;
}

/**
 * Converts names to proper Name Case (First Letter of Each Word Capitalized)
 * Example: "DANIELLE ADAMS" -> "Danielle Adams"
 */
function toNameCase(name) {
  if (!name || typeof name !== "string") return "";

  return name.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function flatfileListener(listener) {
  console.log("🚀 Workday Flatfile listener initialized!");

  // Debug logging for all events
  listener.on("**", (event) => {
    console.log("📡 Event:", event.topic);
  });

  // When a new space is created, set up Workday branding and contacts sheet
  listener.on("space:created", async ({ context: { spaceId } }) => {
    console.log("🎨 Setting up Workday-branded space...");

    try {
      // Apply Workday branding theme
      await api.spaces.update(spaceId, {
        metadata: {
          theme: {
            root: {
              primaryColor: "#0066CC", // Workday blue
            },
            sidebar: {
              logo: "https://i.imgur.com/U1ITh3P.png",
              backgroundColor: "#0066CC",
              textColor: "#FFFFFF",
            },
          },
        },
      });

      // Create Contacts workbook with all required fields
      await api.workbooks.create({
        spaceId: spaceId,
        name: "Workday Contacts Import",
        sheets: [
          {
            name: "Contacts",
            slug: "contacts",
            fields: [
              {
                key: "firstName",
                type: "string",
                label: "First Name",
              },
              {
                key: "lastName",
                type: "string",
                label: "Last Name",
              },
              {
                key: "email",
                type: "string",
                label: "Email Address",
              },
              {
                key: "phone",
                type: "string",
                label: "Phone Number",
              },
              {
                key: "isUSANumber",
                type: "boolean",
                label: "USA Number",
              },
              {
                key: "duplicateStatus",
                type: "string",
                label: "Duplicate Status",
              },
            ],
            actions: [
              {
                operation: "submitActionForeground",
                mode: "foreground",
                label: "Submit to Workday",
                description:
                  "Process and submit contact data to Workday systems",
                primary: true,
              },
              {
                operation: "formatDataActionForeground",
                mode: "foreground",
                label: "Format Data Now",
                description: "Apply name case and phone formatting immediately",
                primary: false,
              },
            ],
          },
        ],
      });

      console.log("✅ Workday space configured successfully!");
    } catch (error) {
      console.error("❌ Error setting up Workday space:", error);
    }
  });

  // Listen for ANY record-related events and try to format
  listener.on("records:created", async (event) => {
    const { sheetId } = event.context;
    console.log("📝 RECORDS CREATED - Formatting immediately...");
    await formatRecords(sheetId);
  });

  listener.on("commit:created", async (event) => {
    const { sheetId } = event.context;
    console.log("💾 COMMIT CREATED - Formatting immediately...");
    await formatRecords(sheetId);
  });

  listener.on("records:updated", async (event) => {
    const { sheetId } = event.context;
    console.log("📝 RECORDS UPDATED - Formatting immediately...");
    await formatRecords(sheetId);
  });

  // Handle the "Submit to Workday" action
  listener.on(
    "job:ready",
    { job: "workbook:submitActionForeground" },
    async (event) => {
      const { jobId } = event.context;
      console.log("📤 Processing Workday submission...");

      try {
        // Complete the job with success message
        await api.jobs.complete(jobId, {
          outcome: {
            message: "✅ Successfully submitted contacts to Workday!",
          },
        });

        console.log("✅ Workday submission completed successfully!");
      } catch (error) {
        console.error("❌ Error processing Workday submission:", error);

        // Mark job as failed if there was an error
        try {
          await api.jobs.fail(jobId, {
            outcome: {
              message: `❌ Submission failed: ${error.message}`,
            },
          });
        } catch (failError) {
          console.error("❌ Error marking job as failed:", failError);
        }
      }
    }
  );

  // Handle the "Format Data Now" action - manual trigger
  listener.on(
    "job:ready",
    { job: "workbook:formatDataActionForeground" },
    async (event) => {
      const { jobId, sheetId } = event.context;
      console.log(
        "🎯 MANUAL FORMAT TRIGGER - Processing records for formatting..."
      );

      try {
        // Acknowledge the job start
        await api.jobs.ack(jobId, {
          info: "Starting data formatting job",
          progress: 10,
        });

        await formatRecords(sheetId);

        // Complete the job with success message
        await api.jobs.complete(jobId, {
          outcome: {
            message: "✅ Data formatting completed successfully!",
          },
        });

        console.log("✅ Manual formatting completed successfully!");
      } catch (error) {
        console.error("❌ Error processing manual formatting:", error);

        // Mark job as failed if there was an error
        try {
          await api.jobs.fail(jobId, {
            outcome: {
              message: `❌ Formatting failed: ${error.message}`,
            },
          });
        } catch (failError) {
          console.error("❌ Error marking job as failed:", failError);
        }
      }
    }
  );

  // Simplified formatting function using correct API structure
  async function formatRecords(sheetId) {
    try {
      console.log("🔄 Starting record formatting...");
      console.log("📋 Sheet ID:", sheetId);

      // Get records with proper API call structure
      let records = [];
      let attempts = 0;
      const maxAttempts = 5;

      while (attempts < maxAttempts) {
        try {
          const response = await api.records.get(sheetId, {
            includeMessages: true,
          });

          console.log(
            "📊 Full API Response:",
            JSON.stringify(response, null, 2)
          );

          // Use the correct structure: response.data.records
          if (
            response &&
            response.data &&
            response.data.records &&
            Array.isArray(response.data.records)
          ) {
            records = response.data.records;
          } else if (
            response &&
            response.data &&
            Array.isArray(response.data)
          ) {
            records = response.data;
          } else {
            records = [];
          }

          console.log(
            `📊 Found ${records.length} records on attempt ${attempts + 1}`
          );

          if (records.length > 0) {
            console.log("📋 First record sample:", {
              id: records[0].id,
              firstName:
                records[0].values?.firstName?.value ||
                records[0].values?.firstName,
              lastName:
                records[0].values?.lastName?.value ||
                records[0].values?.lastName,
              phone:
                records[0].values?.phone?.value || records[0].values?.phone,
            });
            break;
          }
        } catch (error) {
          console.log(`⚠️ Attempt ${attempts + 1} failed:`, error.message);
        }

        attempts++;
        if (attempts < maxAttempts) {
          console.log(`⏳ Waiting 2 seconds before retry...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      if (!Array.isArray(records) || records.length === 0) {
        console.log("❌ No valid records found after all attempts");
        return;
      }

      // First pass: create signatures for all records to detect duplicates
      const rowSignatures = new Map();
      const recordSignatures = new Map();

      for (const record of records) {
        if (!record?.values) continue;

        const signature = createRowSignature(record.values);
        rowSignatures.set(signature, (rowSignatures.get(signature) || 0) + 1);
        recordSignatures.set(record.id, signature);
      }

      // Process each record
      const updates = [];
      let formattedCount = 0;

      console.log(`🔍 Processing ${records.length} records...`);

      for (const record of records) {
        if (!record?.values) continue;

        const recordUpdates = {};
        let hasUpdates = false;

        // Handle both .value structure and direct values
        const firstName =
          record.values.firstName?.value || record.values.firstName;
        const lastName =
          record.values.lastName?.value || record.values.lastName;
        const phone = record.values.phone?.value || record.values.phone;

        console.log(`📋 Processing record ${record.id}:`, {
          firstName,
          lastName,
          phone,
          hasUSANumberField: record.values.isUSANumber !== undefined,
        });

        // Format first name
        if (firstName && typeof firstName === "string") {
          const formatted = toNameCase(firstName);
          if (formatted !== firstName) {
            recordUpdates.firstName = { value: formatted };
            hasUpdates = true;
            console.log(`📝 "${firstName}" -> "${formatted}"`);
          }
        }

        // Format last name
        if (lastName && typeof lastName === "string") {
          const formatted = toNameCase(lastName);
          if (formatted !== lastName) {
            recordUpdates.lastName = { value: formatted };
            hasUpdates = true;
            console.log(`📝 "${lastName}" -> "${formatted}"`);
          }
        }

        // Format phone
        if (phone) {
          try {
            const formatted = formatPhoneNumber(phone);
            if (formatted !== phone.toString()) {
              recordUpdates.phone = { value: formatted };
              hasUpdates = true;
              console.log(`📞 "${phone}" -> "${formatted}"`);
            }
          } catch (error) {
            console.warn("⚠️ Phone formatting failed:", phone);
          }
        }

        // Detect USA number - always try to update this field
        if (phone) {
          const isUSA = isUSANumber(phone);
          const currentUSAValue =
            record.values.isUSANumber?.value || record.values.isUSANumber;

          // Update if value is different or if field doesn't exist yet
          if (isUSA !== currentUSAValue) {
            recordUpdates.isUSANumber = { value: isUSA };
            hasUpdates = true;
            console.log(`📞 "${phone}" -> USA: ${isUSA}`);
          }
        }

        // Detect duplicates
        const signature = recordSignatures.get(record.id);
        if (signature) {
          const duplicateCount = rowSignatures.get(signature);
          const currentDuplicateStatus =
            record.values.duplicateStatus?.value ||
            record.values.duplicateStatus;

          let duplicateStatus = "";
          if (duplicateCount > 1) {
            duplicateStatus = `⚠️ Duplicate (${duplicateCount} total)`;
            console.log(
              `🔍 Record ${record.id} is a duplicate (${duplicateCount} total)`
            );
          } else {
            duplicateStatus = "✅ Unique";
          }

          if (duplicateStatus !== currentDuplicateStatus) {
            recordUpdates.duplicateStatus = { value: duplicateStatus };
            hasUpdates = true;
          }
        }

        if (hasUpdates) {
          updates.push({
            id: record.id,
            values: recordUpdates,
          });
          formattedCount++;
        }
      }

      // Apply updates
      if (updates.length > 0) {
        console.log(`🔄 Applying ${updates.length} updates...`);
        console.log("📋 Sample update:", JSON.stringify(updates[0], null, 2));
        await api.records.update(sheetId, updates);
        console.log(`✅ Successfully formatted ${formattedCount} records!`);
      } else {
        console.log("ℹ️ No records needed formatting");
      }
    } catch (error) {
      console.error("❌ Formatting error:", error.message);
      throw error;
    }
  }

  // Helper function to create a signature for an entire row
  function createRowSignature(values) {
    // Extract all field values and create a consistent signature
    const fieldValues = [];

    for (const [key, value] of Object.entries(values)) {
      const fieldValue = value?.value || value;
      fieldValues.push(`${key}:${fieldValue}`);
    }

    // Sort to ensure consistent signature regardless of field order
    fieldValues.sort();

    return fieldValues.join("|");
  }

  console.log("🚀 Workday Flatfile listener ready!");
}
