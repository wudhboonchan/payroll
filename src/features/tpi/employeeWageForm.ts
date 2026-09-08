type Profile = {
  rate_tier?: string | null
  skilled_from?: string | null
  job_code?: string | null
  job_id?: string | null
}
type JobIdentity = { id: string; code: string }

// Legacy TPI records encode the skilled assignment in job_title, even when
// their profile is missing or still has the default normal tier.
export function employeeWageForm(jobTitle: string | null | undefined, profile: Profile | null | undefined, jobs: JobIdentity[]) {
  const title = jobTitle?.trim() || ''
  const legacyJob = jobs.find(job => job.code.trim().toLowerCase() === title.toLowerCase())
  const legacyCode = legacyJob?.code || (/^\d{6}(?:\/[a-z0-9]+)?$/i.test(title) ? title : '')
  const skilled = profile?.rate_tier === 'skilled' || !!legacyCode
  const code = skilled ? profile?.job_code || legacyCode || title : ''
  const matched = jobs.find(job => job.id === profile?.job_id || job.code.trim().toLowerCase() === code.toLowerCase())
  return {
    rateTier: skilled ? 'skilled' as const : 'normal' as const,
    skilledFrom: skilled && profile?.skilled_from !== '0001-01-01' ? profile?.skilled_from || '' : '',
    jobCode: code,
    jobId: skilled ? profile?.job_id || matched?.id || '' : '',
  }
}
