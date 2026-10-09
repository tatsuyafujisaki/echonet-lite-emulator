/* ------------------------------------------------------------------
 * ユーザー設定情報を扱うモジュール
 * ---------------------------------------------------------------- */
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {readJsonFileIfExists} from './FileUtils.ts';

/* ------------------------------------------------------------------
 * イベント:
 * - updated(uconf) : ユーザー設定情報が更新された
 * ---------------------------------------------------------------- */
class UserConf extends EventEmitter {
  _UCONF_KEY_LIST: any;
  _fpath: any;
  _sys_conf: any;
  _uconf: any;
  constructor(sys_conf: any) {
    super();
    this._sys_conf = sys_conf;
    this._fpath = path.resolve(import.meta.dirname, '../data/user_conf.json');
    this._uconf = null;
    this._UCONF_KEY_LIST = [
      'lang',
      'ip_address_version',
      'packet_log',
      'packet_log_days',
      'multicast_response_wait_min_msec',
      'multicast_response_wait_max_msec',
      'get_res_wait_msec',
      'set_res_wait_msec',
      'inf_res_wait_msec',
      'epc_data_setting_time_msec',
      'instance_announce_interval_sec',
      'property_announce_interval_sec',
      'request_timeout_msec',
      'request_interval_msec',
      'request_retry_limit',
    ];
  }

  init() {
    const uconf = readJsonFileIfExists(this._fpath) ?? {};

    // システム設定のデフォルト値をマージ
    for (const k of this._UCONF_KEY_LIST) {
      if (!(k in uconf)) {
        uconf[k] = this._sys_conf[k];
      }
    }
    this._uconf = uconf;
  }

  /* ------------------------------------------------------------------
   * get()
   * ユーザー設定情報を取得する
   *
   * 引数:
   *   なし
   *
   * 戻値:
   * - 設定情報を格納したハッシュオブジェクト
   * ---------------------------------------------------------------- */
  get() {
    return structuredClone(this._uconf);
  }

  /* ------------------------------------------------------------------
   * set(in_data)
   * ユーザー設定情報をセットする
   *
   * 引数:
   * - in_data = {}
   *   設定キーとそれに対応する値を格納したハッシュオブジェクト
   *   未知の設定キーは無視する
   *
   * 戻値:
   * - Promise オブジェクト
   *
   * 指定された設定値が不正な値だったとしても reject() ではなく resolve() を
   * 呼び出す。reject() が呼び出されるのは、ファイル書き込みに失敗したときなど。
   *
   * resolve() には、結果を表すオブジェクトが渡される:
   *   result | Interger | 値エラーの数 (すべて成功すれば 0),
   *   data   | Object   | 保存した設定値を格納したハッシュオブジェクト
   *          |          | エラーの場合は存在しない
   *   errs   | Object   | 不正な値のキーとエラーメッセージを格納したハッシュオブジェクト
   *          |          | 成功の場合は存在しない
   * ---------------------------------------------------------------- */
  async set(in_data: any): Promise<any> {
    if (
      !in_data ||
      typeof in_data !== 'object' ||
      Object.keys(in_data).length === 0
    ) {
      throw new Error('No parameter was passed.');
    }

    const res = this._checkValues(in_data);
    if (res['result'] !== 0) {
      return res;
    }

    for (const [k, v] of Object.entries(res['data'])) {
      this._uconf[k] = v;
    }
    await fs.promises.writeFile(this._fpath, JSON.stringify(this._uconf));
    this.emit('updated', structuredClone(this._uconf));
    return res;
  }

  _checkValues(in_data: any): any {
    const data: Record<string, any> = {};
    const errs: Record<string, any> = {};

    for (const [k, v] of Object.entries(in_data)) {
      if (k === 'lang') {
        if (/^(ja|en)$/.test(v as string)) {
          data[k] = v;
        } else {
          errs[k] = 'The `' + k + '` must be `ja` or `en`.';
        }
      } else if (k === 'ip_address_version') {
        if (typeof v === 'number' && (v === 4 || v === 6)) {
          data[k] = v;
        } else {
          errs[k] = 'The `' + k + '` must be `4` or `6`.';
        }
      } else if (k === 'packet_log') {
        if (typeof v === 'boolean') {
          data[k] = v;
        } else {
          errs[k] = 'The `' + k + '` must be `true` or `false`.';
        }
      } else if (k === 'packet_log_days') {
        if (typeof v === 'number' && v % 1 === 0 && v >= 1 && v <= 365) {
          data[k] = v;
        } else {
          errs[k] = 'The `' + k + '` must be an integer between 1 and 365.';
        }
      } else if (/^multicast_response_wait_(min|max)_msec$/.test(k)) {
        if (typeof v === 'number' && v % 1 === 0 && v >= 1 && v <= 10000) {
          data[k] = v;
        } else {
          errs[k] = 'The `' + k + '` must be an integer between 1 and 10000.';
        }
      } else if (/^(get|set|inf)_res_wait_msec$/.test(k)) {
        if (typeof v === 'number' && v % 1 === 0 && v >= 0 && v <= 100000) {
          data[k] = v;
        } else {
          errs[k] = 'The `' + k + '` must be an integer between 0 and 100000.';
        }
      } else if (k === 'epc_data_setting_time_msec') {
        if (typeof v === 'number' && v % 1 === 0 && v >= 0 && v <= 100000) {
          data[k] = v;
        } else {
          errs[k] = 'The `' + k + '` must be an integer between 0 and 100000.';
        }
      } else if (/^(instance|property)_announce_interval_sec$/.test(k)) {
        if (typeof v === 'number' && v % 1 === 0 && v >= 0 && v <= 86400) {
          data[k] = v;
        } else {
          errs[k] = 'The `' + k + '` must be an integer between 0 and 86400.';
        }
      } else if (k === 'request_timeout_msec') {
        if (typeof v === 'number' && v % 1 === 0 && v >= 0 && v <= 10000) {
          data[k] = v;
        } else {
          errs[k] = 'The `' + k + '` must be an integer between 0 and 10000.';
        }
      } else if (k === 'request_interval_msec') {
        if (typeof v === 'number' && v % 1 === 0 && v >= 0 && v <= 10000) {
          data[k] = v;
        } else {
          errs[k] = 'The `' + k + '` must be an integer between 0 and 10000.';
        }
      } else if (k === 'request_retry_limit') {
        if (typeof v === 'number' && v % 1 === 0 && v >= 0 && v <= 10) {
          data[k] = v;
        } else {
          errs[k] = 'The `' + k + '` must be an integer between 0 and 10.';
        }
      }
    }

    const err_num = Object.keys(errs).length;
    if (err_num === 0) {
      return {
        result: err_num,
        data: data,
      };
    } else {
      return {
        result: err_num,
        errs: errs,
      };
    }
  }
}

export default UserConf;
