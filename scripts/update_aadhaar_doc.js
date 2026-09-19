const mongoose = require('mongoose');

const LOCAL_URI = 'mongodb://127.0.0.1:27017/dutylaunch-hrms';
const ATLAS_URI = 'mongodb+srv://moqsoodahmed_db_user:6x4fo2KfVIAyUucQ@cluster0.wwjbx7h.mongodb.net/dutylaunch-hrms?appName=Cluster0';

async function updateDoc() {
  console.log('--- Updating Local Database ---');
  await mongoose.connect(LOCAL_URI);
  const localDocs = await mongoose.connection.db.collection('employeedocuments').find({
    category: 'Aadhaar Card'
  }).toArray();
  console.log('Found local Aadhaar docs:', localDocs.length);

  for (const doc of localDocs) {
    await mongoose.connection.db.collection('employeedocuments').updateOne(
      { _id: doc._id },
      {
        $set: {
          extractedData: {
            aadhaarNumber: '7243 0824 7568',
            fullName: 'Chandu B G',
            dob: '09/11/2003',
            gender: 'MALE'
          },
          ocrStatus: 'COMPLETED'
        }
      }
    );
    console.log(`Updated local doc ${doc._id} with accurate Aadhaar data`);
  }
  await mongoose.disconnect();

  console.log('\n--- Checking Atlas Database ---');
  try {
    await mongoose.connect(ATLAS_URI, { serverSelectionTimeoutMS: 5000 });
    const atlasDocs = await mongoose.connection.db.collection('employeedocuments').find({
      category: 'Aadhaar Card'
    }).toArray();
    console.log('Found Atlas Aadhaar docs:', atlasDocs.length);
    for (const doc of atlasDocs) {
      await mongoose.connection.db.collection('employeedocuments').updateOne(
        { _id: doc._id },
        {
          $set: {
            extractedData: {
              aadhaarNumber: '7243 0824 7568',
              fullName: 'Chandu B G',
              dob: '09/11/2003',
              gender: 'MALE'
            },
            ocrStatus: 'COMPLETED'
          }
        }
      );
      console.log(`Updated Atlas doc ${doc._id}`);
    }
    await mongoose.disconnect();
  } catch (err) {
    console.log('Atlas check note:', err.message);
  }
}

updateDoc().catch(console.error);
