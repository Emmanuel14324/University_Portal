import "server-only";
import mongoose from "mongoose";

export class MongoConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MongoConfigurationError";
  }
}

function getMongoUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new MongoConfigurationError(
      "Set MONGODB_URI in .env.local to connect to MongoDB.",
    );
  }
  return uri;
}

// Cache the connection promise across invocations (dev hot-reload + serverless warm reuse)
declare global {
  // eslint-disable-next-line no-var
  var _mongooseConnection: Promise<typeof mongoose> | undefined;
}

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;

  if (global._mongooseConnection) {
    try {
      return await global._mongooseConnection;
    } catch {
      global._mongooseConnection = undefined;
    }
  }

  const uri = getMongoUri();
  const promise = mongoose.connect(uri, {
    bufferCommands: false,
    // Serverless-safe timeouts — don't wait forever for a connection
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 20000,
    connectTimeoutMS: 10000,
    // Keep the connection pool small for serverless
    maxPoolSize: 10,
    minPoolSize: 0,
    maxIdleTimeMS: 10000,
  });

  global._mongooseConnection = promise;

  return promise;
}
