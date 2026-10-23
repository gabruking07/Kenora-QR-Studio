import dotenv from 'dotenv';
import mongoose from 'mongoose';
import app from './app.js';

dotenv.config();

const port = process.env.PORT || 5000;
const mongoUri = process.env.MONGODB_URI;

async function start() {
  if (!mongoUri) {
    throw new Error('MONGODB_URI is missing. Add it to server/.env before starting the API.');
  }

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  console.log('MongoDB connected');

  app.listen(port, () => console.log(`API listening on ${port}`));
}

start().catch((error) => {
  console.error(`API startup failed: ${error.message}`);
  process.exitCode = 1;
});
