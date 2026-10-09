/* ------------------------------------------------------------------
 * パケット送受信データのロギングを扱うモジュール
 * ---------------------------------------------------------------- */
import fs from 'node:fs';
import path from 'node:path';

class PacketLogger {
  _log_days: any;
  _log_dir: any;
  /* ------------------------------------------------------------------
   * Constructor
   * - conf              | object  | optional |
   *   - packet_log_days | integer | optional | ログ保存日数
   * ---------------------------------------------------------------- */
  constructor(conf: any) {
    if (!conf || typeof conf !== 'object') {
      conf = {};
    }
    // ログファイル保存日数
    this._log_days = 3;
    const log_days = conf['packet_log_days'];
    if (
      (typeof log_days === 'number' && log_days % 1 === 0 && log_days > 0) ||
      log_days < 365
    ) {
      this._log_days = log_days;
    }
    // ログファイル格納ディレクトリのパス
    this._log_dir = path.resolve(import.meta.dirname, '../logs');
  }

  /* ------------------------------------------------------------------
   * init()
   * 初期化
   * ---------------------------------------------------------------- */
  init() {
    fs.mkdirSync(this._log_dir, {recursive: true});
    setInterval(() => {
      this._delteOldLogFiles();
    }, 3600000);
    this._delteOldLogFiles();
  }

  /* ------------------------------------------------------------------
   * tx(address, parsed)
   * 送信ログ書き込み
   * ---------------------------------------------------------------- */
  tx(address: any, parsed: any) {
    this._log('tx', address, parsed);
  }

  /* ------------------------------------------------------------------
   * rx(address, parsed)
   * 受信ログ書き込み
   * ---------------------------------------------------------------- */
  rx(address: any, parsed: any) {
    this._log('rx', address, parsed);
  }

  _log(direction: any, address: any, parsed: any) {
    if (!parsed) {
      return;
    }

    const dt = new Date();
    const date = this._getDate(dt);
    const time_stamp = this._getTimeStamp(dt);

    const log_cols = [
      time_stamp,
      direction.toUpperCase(),
      address,
      parsed['result'],
    ];
    if (parsed['result'] === 0) {
      log_cols.push('"' + parsed['data']['hex'] + '"');
      log_cols.push('""');
    } else {
      log_cols.push('"' + parsed['hex'] + '"');
      log_cols.push('"' + parsed['message'] + '"');
    }
    const log = log_cols.join(' ') + '\n';

    const fpath = this._log_dir + '/packet.' + date + '.log';
    fs.promises.appendFile(fpath, log, 'utf8').catch(error => {
      console.error(error);
    });
  }

  /* ------------------------------------------------------------------
   * txError(address, parsed)
   * 送信エラーログ書き込み
   *
   * - address   | 必須 | 送信パケットなら宛先の、受信パケットなら送信元の IP アドレス
   * - parsed    | 必須 | EL パケット解析済みオブジェクト
   * ---------------------------------------------------------------- */
  txError(address: any, parsed: any) {
    this._error('tx', address, parsed);
  }

  /* ------------------------------------------------------------------
   * rxError(message, address, parsed)
   * 受信エラーログ書き込み
   *
   * - address   | 必須 | 送信パケットなら宛先の、受信パケットなら送信元の IP アドレス
   * - parsed    | 必須 | EL パケット解析済みオブジェクト
   * ---------------------------------------------------------------- */
  rxError(address: any, parsed: any) {
    this._error('rx', address, parsed);
  }

  _error(direction: any, address: any, parsed: any) {
    if (!parsed) {
      return;
    }

    const dt = new Date();
    const date = this._getDate(dt);
    const time_stamp = this._getTimeStamp(dt);

    const log_cols = [
      time_stamp,
      direction.toUpperCase(),
      address,
      parsed['result'],
    ];

    log_cols.push('"' + parsed['hex'] + '"');
    log_cols.push('"' + parsed['message'] + '"');

    let log = log_cols.join(' ') + '\n';

    if (parsed['data']) {
      log += '\n';
      log += JSON.stringify(parsed['data'], null, '  ');
      log += '\n';
    }

    const fpath = this._log_dir + '/packet.error.' + date + '.log';
    fs.promises.appendFile(fpath, log, 'utf8').catch(error => {
      console.error(error);
    });
  }

  _getTimeStamp(dt: any) {
    const date = this._getDate(dt);
    const time = this._getTime(dt);
    const tz = this._getTz(dt);
    const time_stamp = date + 'T' + time + tz;
    return time_stamp;
  }

  _getDate(dt: any) {
    const Y = dt.getFullYear();
    const M = this._zeroPadding(dt.getMonth() + 1);
    const D = this._zeroPadding(dt.getDate());
    return [Y, M, D].join('-');
  }

  _getTime(dt: any) {
    const h = this._zeroPadding(dt.getHours());
    const m = this._zeroPadding(dt.getMinutes());
    const s = this._zeroPadding(dt.getSeconds());
    const ms = ('00' + dt.getMilliseconds()).slice(-3);
    return [h, m, s].join(':') + '.' + ms;
  }

  _getTz(dt: any) {
    let tzoffset = dt.getTimezoneOffset();
    let tz = tzoffset >= 0 ? '-' : '+';
    tzoffset = Math.abs(tzoffset);
    tz += this._zeroPadding(Math.floor(tzoffset / 60));
    tz += ':';
    tz += this._zeroPadding(tzoffset % 60);
    return tz;
  }

  _zeroPadding(n: any) {
    return ('0' + n).slice(-2);
  }

  async _delteOldLogFiles() {
    // x日前の日付 (YYYYMMDDを数値型に)
    const dt = new Date();
    dt.setDate(dt.getDate() - this._log_days);
    const pastday = parseInt(this._getDate(dt).replace(/\-/g, ''), 10);
    // logsディレクトリ内のファイルの一覧
    let files;
    try {
      files = await fs.promises.readdir(this._log_dir);
    } catch (error) {
      console.error(error);
      return;
    }
    for (const fname of files) {
      const m = fname.match(
        /^packet\.(?:error\.)?(\d{4})\-(\d{2})\-(\d{2})\.log$/,
      );
      if (!m) {
        continue;
      }
      const d = parseInt(m[1]! + m[2]! + m[3]!, 10);
      if (d >= pastday) {
        continue;
      }
      try {
        await fs.promises.unlink(this._log_dir + '/' + fname);
      } catch (error) {
        console.error(error);
      }
    }
  }
}

export default PacketLogger;
