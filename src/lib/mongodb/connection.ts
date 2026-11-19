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

// Reuse connection across hot-reloads in development
declare global {
  // eslint-disable-next-line no-var
  var _mongooseConnection: Promise<typeof mongoose> | undefined;
}

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;

  if (global._mongooseConnection) return global._mongooseConnection;

  const uri = getMongoUri();
  const promise = mongoose.connect(uri, {
    bufferCommands: false,
  });

  if (process.env.NODE_ENV !== "production") {
    global._mongooseConnection = promise;
  }

  return promise;
}
