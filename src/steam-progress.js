'use strict';

// SteamCMD reports a separate percentage for downloading and for verification.
// Preserve that distinction rather than inventing an overall completion estimate.
function parseSteamProgress(line, previous = {}) {
  if (previous.step === 'installFinished') return { phase: previous.phase, step: previous.step, percent: previous.percent };
  let phase = previous.phase || 'steamcmd';
  let step = previous.step || 'connectingSteam';
  let percent;
  let reportsPercent = true;
  if (/Success! App '996560' fully installed/i.test(line)) return { phase: 'game', step: 'installFinished', percent: 100 };
  if (/Update state/i.test(line)) {
    phase = 'game';
    if (/downloading/i.test(line)) step = 'downloadingGame';
    else if (/verifying|validating/i.test(line)) step = 'verifyingGame';
    else if (/reconfiguring|preallocating/i.test(line)) step = 'preparingGame';
    else if (/committing|installing/i.test(line)) step = 'installingGame';
    else reportsPercent = false; // Steam can print "unknown, progress: 0" after verification.
  } else if (/downloading update|descargando archivos|descargando actualizaci[oó]n/i.test(line)) { phase = 'steamcmd'; step = 'steamcmdDownload'; }
  else if (/extracting|extrayendo/i.test(line)) { phase = 'steamcmd'; step = 'steamcmdExtract'; }
  else if (/applying update|installing update|instalando actualizaci[oó]n/i.test(line)) { phase = 'steamcmd'; step = 'steamcmdUpdate'; }
  else if (/verifying installation|verificando instalaci[oó]n|checking for available update|buscando actualizaciones/i.test(line)) { phase = 'steamcmd'; step = 'steamcmdUpdate'; }
  else if (/connecting anonymously|waiting for client config|waiting for user info|\bloading steam api/i.test(line)) step = 'connectingSteam';
  if (reportsPercent) {
    const match = line.match(/progress:\s*([\d]+(?:[.,]\d+)?)/i) || line.match(/\[\s*(\d+(?:[.,]\d+)?)%\]/);
    if (match) percent = Math.round(Math.min(100, Math.max(0, Number(match[1].replace(',', '.')))) * 10) / 10;
  }
  if (percent === undefined) percent = phase === previous.phase && step === previous.step ? previous.percent ?? null : null;
  return { phase, step, percent };
}

module.exports = { parseSteamProgress };
