/* ------------------------------------------------------------------
 * ファイル操作のユーティリティ
 * ---------------------------------------------------------------- */
import fs from 'node:fs';

// JSON ファイルを読み取ってパースする (ファイルが存在しなければ null を返す)
export function readJsonFileIfExists(fpath: string): any {
  let text: string;
  try {
    text = fs.readFileSync(fpath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  return JSON.parse(text);
}
