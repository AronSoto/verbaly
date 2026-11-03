import type { ResolvedConfig } from '../../config/config';
import { doctor, formatDoctorEntry, formatDoctorHealth } from '../../project/doctor';
import { counted } from '../../util/text';

export async function doctorCommand(cfg: ResolvedConfig): Promise<void> {
  const result = await doctor(cfg);
  console.log(`[verbaly] doctor: ${counted(result.entries.length, 'check')}`);
  for (const entry of result.entries) {
    const line = formatDoctorEntry(entry);
    if (entry.level === 'error') console.error(line);
    else if (entry.level === 'warn') console.warn(line);
    else console.log(line);
  }
  if (result.ok) {
    console.log(`[verbaly] ${formatDoctorHealth(result)} ✓`);
  } else {
    console.error('[verbaly] doctor found problems');
    process.exitCode = 1;
  }
}
