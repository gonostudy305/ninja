const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set } = require('firebase/database');

const firebaseConfig = {
    apiKey: "AIzaSyDqATaYvwKvE-9xy5WZXbTTQDxoIZuEL0k",
    authDomain: "ninja-55773.firebaseapp.com",
    databaseURL: "https://ninja-55773-default-rtdb.asia-southeast1.firebasedatabase.app/",
    projectId: "ninja-55773",
    storageBucket: "ninja-55773.firebasestorage.app",
    messagingSenderId: "1046615193750",
    appId: "1:1046615193750:web:1f95527637274456a1eab7"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

async function test() {
  try {
    console.log("Connecting...");
    await set(ref(db, 'test'), { hello: 'world' });
    console.log("Success!");
  } catch (e) {
    console.error("Error:", e.message);
  }
  process.exit();
}
test();
