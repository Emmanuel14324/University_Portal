export class MongoConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MongoConfigurationError";
  }
}

export function getMongoConfig() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new MongoConfigurationError(
      "Set MONGODB_URI in .env.local to connect to MongoDB.",
    );
  }
  return { uri };
}
