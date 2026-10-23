/**
 * RaftNow web API client.
 *
 * The previous version of this file returned hard-coded stretches and slots
 * whenever the API failed, which made the booking page look functional while
 * the backend had no such endpoints. All data now comes from the real API;
 * failures surface as ApiError and are shown to the user.
 */
export * from '../lib/api';
