/**
 * Problems Flatter expects and explains to the user (a frozen story, a paragraph too long to measure).
 * Every other error means InDesign or the plugin platform behaved in a way Flatter does not know: the
 * panel shows those with the compatibility alarm.
 */
export class FlatterUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlatterUserError';
  }
}

/** True for errors Flatter raised on purpose (works across bundles, unlike instanceof). */
export function isUserError(e: unknown): boolean {
  return (e as { name?: string } | undefined)?.name === 'FlatterUserError';
}
