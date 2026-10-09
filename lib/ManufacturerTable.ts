/* ------------------------------------------------------------------
 * manufacturerTable.json のデータを扱うモジュール
 *
 * - manufacturerTable.json を扱いやすいように以下の通りに変換
 *   - 0xFF を FF に変換 (0x の削除)
 * - メーカーコードを指定したら、それに該当するデータを返す
 * ---------------------------------------------------------------- */
import fs from 'node:fs';
import path from 'node:path';

class ManufacturerTable {
  _manus: any;
  constructor() {
    this._manus = {};
  }

  /* ------------------------------------------------------------------
   * init()
   * ---------------------------------------------------------------- */
  init() {
    // JSON を読み込む
    const json_fpath = path.resolve(
      import.meta.dirname,
      '../conf/manufacturerCode.json',
    );
    const obj = JSON.parse(fs.readFileSync(json_fpath, 'utf8'));
    const o = obj['data'];
    // メーカーコードの `0x` を削除する
    const manus: any = {};
    Object.keys(o).forEach(mcode => {
      const data = o[mcode];
      const code = mcode.replace(/^0x/, '').toUpperCase();
      manus[code] = data;
    });
    this._manus = manus;
  }

  /* ------------------------------------------------------------------
   * get(code)
   * メーカーコードから該当のデータを返す
   *
   * 引数:
   * - code  | String | required | メーカーコード (例: `0000FB`)
   *
   * 戻値:
   * - 以下のハッシュオブジェクト
   *   {
   *     "ja": "日本語のメーカー名",
   *     "en": "英語のメーカー名"
   *   }
   *
   *  - もし指定のメーカーコードが見つからなければ null を返す
   * ---------------------------------------------------------------- */
  get(code: any) {
    if (!code || typeof code !== 'string' || !/^[0-9A-Fa-f]{6}$/.test(code)) {
      return null;
    }
    const d = this._manus[code];
    if (d) {
      return structuredClone(d);
    } else {
      return null;
    }
  }

  /* ------------------------------------------------------------------
   * getList()
   * 全メーカー情報をリストで返す
   *
   * 引数:
   *  - なし
   *
   * 戻値:
   * - 以下のハッシュオブジェクトを入れた配列
   *   [
   *     {
   *       "code : "メーカーコード (例: `0x0000FB`)",
   *       "name": {
   *         "ja": "日本語のメーカー名",
   *         "en": "英語のメーカー名"
   *       }
   *     },
   *     ...
   *   ]
   * ---------------------------------------------------------------- */
  getList() {
    const list: any = [];
    Object.keys(this._manus)
      .sort()
      .forEach(code => {
        list.push({
          code: code,
          name: structuredClone(this._manus[code]),
        });
      });
    return list;
  }
}

const manufacturerTable = new ManufacturerTable();
manufacturerTable.init();
export default manufacturerTable;
