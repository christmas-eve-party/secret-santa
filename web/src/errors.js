// Turns an error into a sentence the page can show.
export function friendlyError(error) {
  if (error?.fromServer && error.message) return error.message; // written for people in Code.gs
  return "Couldn't reach the server. Check your connection and try again.";
}
