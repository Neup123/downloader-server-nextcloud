/** Signed-user first-run guide; a queued/unverified or foreign job is not proof. */
export type FirstRunJob = {
  owner_id?: string;
  status: string;
  output_files?: readonly {verified?: boolean}[];
};

export function firstDownloadVerified(
  signedOwner: string,
  persistedFlag: boolean,
  jobs: readonly FirstRunJob[],
): boolean {
  if (!signedOwner) return false;
  if (persistedFlag) return true;
  return jobs.some(job =>
    job.owner_id === signedOwner &&
    job.status === 'completed' &&
    Array.isArray(job.output_files) &&
    job.output_files.length > 0 &&
    job.output_files.every(file => file?.verified === true),
  );
}

export function showFirstRunGuide(
  signedOwner: string, filesConnected: boolean, hasVerifiedDownload: boolean,
): boolean {
  return Boolean(signedOwner) && (!filesConnected || !hasVerifiedDownload);
}
