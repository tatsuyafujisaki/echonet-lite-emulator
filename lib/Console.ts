/* ------------------------------------------------------------------
 * コンソール出力
 * ---------------------------------------------------------------- */
import fs from 'node:fs';
import path from 'node:path';
import {styleText} from 'node:util';

class Console {
  _ASCII_ART_TEXT_PATH: any;
  _current_pos: any;
  /* ------------------------------------------------------------------
   * コンストラクタ
   *
   * [引数]
   * - なし
   * ---------------------------------------------------------------- */
  constructor() {
    // カーソルの位置
    this._current_pos = 0;

    // ASCII アートテキストのファイルパス
    this._ASCII_ART_TEXT_PATH = path.resolve(
      import.meta.dirname,
      '../conf/start_logo_aa.txt',
    );
  }

  /* ------------------------------------------------------------------
   * printStartLogoAsciiArt()
   * システム起動時用の ASCII アートを出力
   *
   * - elemu/conf/start_logo_aa.txt の内容を出力する
   * - 上記テキストファイルが存在しなければ何も表示しない
   *
   * 引数:
   *   なし
   *
   * 戻値:
   *   なし
   * ---------------------------------------------------------------- */
  printStartLogoAsciiArt() {
    let text = '';
    try {
      text = fs.readFileSync(this._ASCII_ART_TEXT_PATH, 'utf8');
    } catch {
      // Do nothing
    }
    if (text) {
      console.log(styleText('cyan', text));
    }
  }

  printVersion(version: any) {
    console.log(version);
    console.log('');
  }

  printDeviceDescriptionMetaData(data: any) {
    console.log('Machine Readable Appendix');
    console.log('- Date        : ' + data.date);
    console.log('- Release     : ' + data.release);
    console.log('- Data Version: ' + data.dataVersion);
    console.log('- Copyright   : ' + data.Copyright);
    console.log('');
  }

  /* ------------------------------------------------------------------
   * printSysInitMsg(msg)
   * システム起動に関連したメッセージ出力
   *
   * - 後に処理結果 (OK or NG) を同じ行に出力することを想定しているため、
   *   改行を入れずにメッセージを出力する
   * - 後に必ず printSysInitRes() を呼び出すこと。
   *
   * 引数:
   *   - msg   | String | required | メッセージ文字列
   *
   * 戻値:
   *   なし
   * ---------------------------------------------------------------- */
  printSysInitMsg(msg: any) {
    this._printSysPrefix();
    process.stdout.write(msg);
    this._current_pos += msg.length;
  }

  _printSysPrefix() {
    process.stdout.write('[' + styleText('yellow', 'SY') + '] ');
    this._current_pos = 5;
  }

  /* ------------------------------------------------------------------
   * printSysInitRes(res)
   * システム起動の結果出力
   *
   * - コンソールの右端に [  OK ] などの結果を表示する。
   * - 最後に改行を入れる。
   *
   * 引数:
   *   - res   | String | required | "OK" または "NG"
   *
   * 戻値:
   *   なし
   * ---------------------------------------------------------------- */
  printSysInitRes(res: any) {
    const w = process.stdout.columns;
    const white_spece_len = w - this._current_pos - 9;
    if (white_spece_len > 0) {
      let white_spaces = '';
      for (let i = 0; i < white_spece_len; i++) {
        white_spaces += ' ';
      }
      process.stdout.write(white_spaces);
    }

    if (res === 'OK') {
      console.log('[  ' + styleText('green', 'OK') + '  ] ');
    } else {
      console.log('[  ' + styleText('red', 'NG') + '  ] ');
    }

    this._current_pos = 0;
  }

  /* ------------------------------------------------------------------
   * printSysInfo(msg)
   * システムに関連したメッセージ出力
   *
   * - 改行を入れてメッセージを出力する
   *
   * 引数:
   *   - msg   | String | required | メッセージ文字列
   *
   * 戻値:
   *   なし
   * ---------------------------------------------------------------- */
  printSysInfo(msg: any) {
    this._printSysPrefix();
    console.log(msg);
  }

  /* ------------------------------------------------------------------
   * printPacketRx(address, hex)
   * パケットの受信内容を出力する
   *
   * - 改行を入れてメッセージを出力する
   *
   * 引数:
   *   - address | String | required | IP アドレス
   *   - hex     | String | required | パケットの 16 進数文字列
   *
   * 戻値:
   *   なし
   * ---------------------------------------------------------------- */
  printPacketRx(address: any, hex: any) {
    this._printPacketRxPrefix();
    console.log('From : ' + address);
    console.log('     ' + hex);
  }

  _printPacketRxPrefix(_dir?: any) {
    process.stdout.write('[' + styleText('magenta', 'RX') + '] ');
    this._current_pos = 5;
  }

  /* ------------------------------------------------------------------
   * printPacketTx(address, hex)
   * パケットの送信内容を出力する
   *
   * 引数:
   *   - address | String | required | IP アドレス
   *   - hex     | String | required | パケットの 16 進数文字列
   *
   * 戻値:
   *   なし
   * ---------------------------------------------------------------- */
  printPacketTx(address: any, hex: any) {
    this._printPacketTxPrefix();
    console.log('To   : ' + address);
    console.log('     ' + hex);
  }

  _printPacketTxPrefix(_dir?: any) {
    process.stdout.write('[' + styleText('cyan', 'TX') + '] ');
    this._current_pos = 5;
  }

  /* ------------------------------------------------------------------
   * printError(msg, error)
   * エラーを出力する
   *
   * 引数:
   *   - msg   | String | required | メッセージ
   *   - error | Error  | required | Error オブジェクト
   *
   * 戻値:
   *   なし
   * ---------------------------------------------------------------- */
  printError(msg: any, error: any) {
    process.stdout.write('[' + styleText('red', 'ER') + '] ');
    console.log(msg);
    console.error(error);
  }
}

export default Console;
