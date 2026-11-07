type SupabaseConfig = {
  url: string;
  publishableKey: string;
};

export class SupabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigurationError";
  }
}

export function getSupabaseConfig(): SupabaseConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new SupabaseConfigurationError(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new SupabaseConfigurationError(
      "NEXT_PUBLIC_SUPABASE_URL must be a valid absolute URL.",
    );
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new SupabaseConfigurationError(
      "NEXT_PUBLIC_SUPABASE_URL must use HTTP or HTTPS.",
    );
  }

  if (process.env.NODE_ENV === "production" && parsedUrl.protocol !== "https:") {
    throw new SupabaseConfigurationError(
      "Supabase must use HTTPS in production.",
    );
  }

  return { url, publishableKey };
}
