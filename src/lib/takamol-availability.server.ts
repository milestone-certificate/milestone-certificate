import {
  buildTakamolUrl,
  fetchTakamolWithRetry,
  readTakamolJson,
  releaseTakamolBody,
  takamolErrorMessage,
  unwrapTakamolResponse,
  type TakamolFetchOptions,
  type TakamolLookupRequest,
  type TakamolLookupResult,
} from "@/lib/takamol-availability.shared";

function takamolApiKey(): string | null {
  const candidates = [
    process.env["TAKAMOL_API_KEY"],
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[
      "TAKAMOL_API_KEY"
    ],
  ];
  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() ?? null;
}

/** Internal client; callers enforce the portal role before requesting availability. */
export async function fetchTakamolAvailability(
  request: TakamolLookupRequest,
  options: TakamolFetchOptions = {},
): Promise<TakamolLookupResult> {
  const apiKey = takamolApiKey();
  if (!apiKey) {
    return {
      success: false,
      status: 503,
      message:
        "Takamol availability is not configured. Add TAKAMOL_API_KEY to the server environment.",
    };
  }
  try {
    const response = await fetchTakamolWithRetry(buildTakamolUrl(request), apiKey, options);
    if (!response.ok) {
      await releaseTakamolBody(response);
      return {
        success: false,
        status: response.status,
        message: takamolErrorMessage(response.status),
      };
    }
    const result = unwrapTakamolResponse(await readTakamolJson(response));
    return result ?? { success: false, status: 502, message: takamolErrorMessage(502) };
  } catch {
    return { success: false, status: 502, message: takamolErrorMessage(502) };
  }
}
