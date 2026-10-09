/* ------------------------------------------------------------------
 * EL パケットのパーサー
 * ---------------------------------------------------------------- */
class PacketParser {
  _ESV_MAP: any;
  _debug: any;
  _mDeviceDescription: any;
  _mManufacturerTable: any;
  _node_profile_desc: any;
  /* ------------------------------------------------------------------
   * Constructor
   * ---------------------------------------------------------------- */
  constructor(mDeviceDescription: any, mManufacturerTable: any) {
    this._mDeviceDescription = mDeviceDescription;
    this._mManufacturerTable = mManufacturerTable;

    this._ESV_MAP = {
      '60': 'SETI',
      '61': 'SETC',
      '62': 'GET',
      '63': 'INF_REQ',
      '6E': 'SETGET',
      '71': 'SET_RES',
      '72': 'GET_RES',
      '73': 'INF',
      '74': 'INFC',
      '7A': 'INFC_RES',
      '7E': 'SETGET_RES',
      '50': 'SETI_SNA',
      '51': 'SETC_SNA',
      '52': 'GET_SNA',
      '53': 'INF_SNA',
      '5E': 'SETGET_SNA',
    };

    this._node_profile_desc = this._mDeviceDescription.getEoj('0EF0');
  }

  /* ------------------------------------------------------------------
   * parse(buf, release)
   * EL パケットを表す Buffer オブジェクトを解析する
   *
   * - 解析に失敗しても null は返さない
   * - 返すオブジェクトの `result` が 0 なら解析成功、そうでなければ失敗。
   * - 解析失敗時は `err` に処理分岐判定のためのキーワードがセットされる。(例: "OPC_OVERFLOW")
   * - 解析失敗時は `message` に理由が文字列でセットされる。 (例: "The OPC is too large.")
   * - 返すデータは _createParseResponse() と _createParseError() を参照。
   * - release はオプション。指定がなければ最新の規格 Version 情報 (リリース番号) として処理
   * ---------------------------------------------------------------- */
  parse(buf: any, release: any) {
    const buf_list: any[] = [];
    const data: any = {};

    // Check the packe size
    if (buf.length < 12) {
      return this._createParseError(
        1,
        'PACKET_SIZE_INVAID',
        'The packet size was less than 12 bytes.',
        buf,
      );
    }

    // EHD1 (ECHONET Lite Header 1)
    const ehd1_buf = buf.slice(0, 1);
    const ehd1_value = ehd1_buf.readUInt8(0);
    if (ehd1_value !== 0b00010000) {
      return this._createParseError(
        2,
        'EHD1_INVALID.',
        'The EDT1 was not equivalent to `0b00010000`.',
        buf,
      );
    }

    // EHD2 (ECHONET Lite Header 2)
    const ehd2_buf = buf.slice(1, 2);
    const ehd2_value = ehd2_buf.readUInt8(0);
    if (ehd2_value !== 0x81) {
      return this._createParseError(
        3,
        'EHD2_INVALID.',
        'The EDT2 was not equivalent to `0x81`.',
        buf,
      );
    }

    const edh_buf = buf.slice(0, 2);
    buf_list.push(edh_buf);
    data['ehd'] = {
      hex: edh_buf.toString('hex').toUpperCase(),
    };

    // TID (Transaction ID)
    const tid_buf = buf.slice(2, 4);
    buf_list.push(tid_buf);
    data['tid'] = {
      hex: tid_buf.toString('hex').toUpperCase(),
      value: tid_buf.readUInt16BE(0),
    };

    // SEOJ (Source ECHONET Lite object specification)
    const seoj_buf = buf.slice(4, 7);
    const seoj_hex = seoj_buf.toString('hex').toUpperCase();
    const seoj_desc = this._mDeviceDescription.getEoj(seoj_hex);
    if (!seoj_desc) {
      return this._createParseError(
        11,
        'SEOJ_UNKNOWN',
        'The SEOJ `' + seoj_hex + '` is unknown.',
        buf,
      );
    }

    buf_list.push(seoj_buf);
    data['seoj'] = {
      hex: seoj_hex,
      className: seoj_desc['className'],
    };

    // DEOJ (Destination ECHONET Lite object specification)
    const deoj_buf = buf.slice(7, 10);
    const deoj_hex = deoj_buf.toString('hex').toUpperCase();
    const deoj_desc = this._mDeviceDescription.getEoj(deoj_hex, null, release);
    if (!deoj_desc) {
      return this._createParseError(
        21,
        'DEOJ_UNKNOWN',
        'The DEOJ `' + deoj_hex + '` is unknown.',
        buf,
      );
    }

    buf_list.push(deoj_buf);
    data['deoj'] = {
      hex: deoj_hex,
      className: deoj_desc['className'],
    };

    // ESV (ECHONET Lite service)
    const esv_buf = buf.slice(10, 11);
    buf_list.push(esv_buf);
    const esv_value = esv_buf.readUInt8(0);
    const esv_hex = esv_buf.toString('hex').toUpperCase();
    if (!this._ESV_MAP[esv_hex]) {
      return this._createParseError(
        31,
        'ESV_UNKWNON',
        'The ESV `' + esv_hex + '` is unknown.',
        buf,
      );
    }
    data['esv'] = {
      hex: esv_hex,
      serviceName: this._ESV_MAP[esv_hex],
    };

    let desc = null;
    let parse_target_eoj = '';
    if (esv_value >= 0x60 && esv_value <= 0x6f) {
      // ESV Codes for Request
      desc = deoj_desc;
      parse_target_eoj = deoj_hex;
    } else {
      // ESV Codes for Response/Notification
      desc = seoj_desc;
      parse_target_eoj = seoj_hex;
    }

    // OPC and Properties
    const pparsed = this._parseOpcProps(buf.slice(11), desc, parse_target_eoj);
    if (pparsed['error']) {
      const e = pparsed['error'];
      return this._createParseError(e['result'], e['err'], e['message'], buf);
    }
    pparsed['buf_list'].forEach(chunk => {
      buf_list.push(chunk);
    });
    data['opc'] = pparsed['data']['opc'];
    data['properties'] = pparsed['data']['properties'];

    // ESV が SetGet 系なら追加の Buffer が残っているはず
    if (pparsed['remain_buf']) {
      if (/^(6E|7E|5E)$/.test(esv_hex)) {
        const pparsed2 = this._parseOpcProps(
          pparsed['remain_buf'],
          desc,
          parse_target_eoj,
        );
        if (pparsed2['error']) {
          const e = pparsed2['error'];
          return this._createParseError(
            e['result'],
            e['err'],
            e['message'],
            buf,
          );
        }
        pparsed2['buf_list'].forEach(chunk => {
          buf_list.push(chunk);
        });
        data['opc2'] = pparsed2['data']['opc'];
        data['properties2'] = pparsed2['data']['properties'];
      }
    }
    const parsed = {
      hex: this._convBufListToHexString(buf_list),
      data: data,
    };
    return this._createParseResponse(parsed, buf);
  }

  _parseOpcProps(buf: any, desc: any, parse_target_eoj: any) {
    const buf_list: any[] = [];
    const data: any = {
      opc: {},
      properties: [],
    };
    let error = null;

    // OPC (Number of processing properties)
    const opc_buf = buf.slice(0, 1);
    const opc_value = opc_buf.readUInt8(0);
    buf_list.push(opc_buf);
    data['opc'] = {
      hex: opc_buf.toString('hex').toUpperCase(),
      value: opc_value,
    };

    // Processing Properties
    let offset = 1;

    for (let i = 0; i < opc_value; i++) {
      const prop_start_offset = offset;
      // EPC (ECHONET Lite Property)
      if (buf.length < offset + 1) {
        error = {
          result: 41,
          err: 'OPC_OVERFLOW',
          message: 'The OPC was too large.',
          data: data,
        };
        break;
      }
      const epc_buf = buf.slice(offset, offset + 1);
      const epc_hex = epc_buf.toString('hex').toUpperCase();
      offset += 1;
      // PDC (Property data counter)
      if (buf.length < offset + 1) {
        error = {
          result: 42,
          err: 'PDC_MISSING',
          message:
            'The PDC could not be retrieved because the packet size was too short.',
          data: data,
        };
        break;
      }
      const pdc_buf = buf.slice(offset, offset + 1);
      const pdc_value = pdc_buf.readUInt8(0);
      offset += 1;
      if (buf.length < offset + pdc_value) {
        error = {
          result: 43,
          err: 'EDT_MISSING',
          message:
            'The EDT could not retrieved because the packet size was too short.',
          data: data,
        };
        break;
      }
      // EDT (Property value data)
      let edt_buf = null;
      if (pdc_value > 0) {
        edt_buf = buf.slice(offset, offset + pdc_value);
        offset += pdc_value;
      }

      let prop_desc = desc['elProperties'][epc_hex];

      // Description に EPC が見つからなければ、たぶん、ノードプロファイルの EPC
      if (!prop_desc) {
        prop_desc = this._node_profile_desc['elProperties'][epc_hex];
      }

      const epc_name = prop_desc ? prop_desc['propertyName'] : null;

      let edt_data = null;
      let edt_hex = null;
      if (edt_buf) {
        edt_hex = edt_buf.toString('hex').toUpperCase();
        if (prop_desc) {
          edt_data = this.parsePropertyValue(
            prop_desc['data'],
            edt_buf,
            epc_hex,
            parse_target_eoj,
          );
        }
      }

      // レスポンス生成
      const prop_buf = buf.slice(prop_start_offset, offset);
      buf_list.push(prop_buf);

      const note = prop_desc && 'note' in prop_desc ? prop_desc['note'] : null;

      data['properties'].push({
        hex: prop_buf.toString('hex').toUpperCase(),
        epc: {
          hex: epc_hex,
          propertyName: epc_name,
        },
        pdc: {
          hex: pdc_buf.toString('hex').toUpperCase(),
          value: pdc_value,
        },
        edt: {
          hex: edt_hex,
          data: edt_data,
          note: note,
        },
      });
    }

    let remain_buf = null;
    if (buf.length > offset) {
      remain_buf = buf.slice(offset);
    }

    return {
      buf_list: buf_list,
      data: data,
      remain_buf: remain_buf,
      error: error,
    };
  }

  _createParseResponse(data: any, buf: any) {
    const hex = buf.toString('hex').toUpperCase();
    return {
      result: 0,
      message: null,
      err: null,
      hex: hex,
      data: data,
    };
  }

  _createParseError(
    code: any,
    err: any,
    message: any,
    buf: any,
    data_data?: any,
  ) {
    const hex = buf.toString('hex').toUpperCase();
    return {
      result: code,
      err: err, // err はエラーの内容を表すキーワードで、処理判断に使われる (例: OPC_OVERFLOW)
      message: message,
      hex: hex,
      data: data_data ? {data: data_data} : null,
    };
  }

  /* ------------------------------------------------------------------
   * parsePropertyValue(pdata, edt_buf, epc_hex, eoj_hex, release)
   * EDT の Buffer オブジェクトを解析する
   *
   * 引数
   * - pdata   | Object | required | 該当の EDT の Description データ
   * - edt_buf | Buffer | required | EDT の Buffer オブジェクト
   * - epc_hex | String | optional | EPC の 16 進数文字列
   * - eoj_hex | String | optional | EOJ の 16 進数文字列
   * - release | String | optional | デバイスのリリースバージョン (例: "J")
   *
   * 戻値
   * - 解析結果を表すハッシュオブジェクト。type によって内容は異なる。
   *
   *   - number の場合
   *     - type          | String | 'number' 固定
   *     - number        | Object |
   *       - format      | String | "int8", "int16", "int32", "uint8", "uint16", "uint32" のいずれか
   *       - unit        | String | 数値の単位。なければ null。
   *       - minimum     | Number | 規格上の最小値
   *       - maximum     | Number | 規格上の最大値
   *       - multiple    | Float  | 倍率
   *       - coefficient | Array  | 係数。EPC の 16 進数文字列のリスト。
   *       - value       | Number | multiple 反映済みの EDT が表す数値 (coefficient は考慮していない)
   *
   *   - state の場合
   *     - type          | String | 'state' 固定
   *     - state         | Object |
   *       - ja          | String | 日本語表記
   *       - en          | String | 英語表記
   *
   *   - numericValue の場合
   *     - type          | String | 'numericValue' 固定
   *     - numericValue  | Number | EDT が表す数値
   *
   *   - level の場合
   *     - type          | String | 'level' 固定
   *     - level         | Number | EDT が表すレベル値
   *
   *   - bitmap の場合
   *     - type          | String | 'bitmap' 固定
   *     - bitmap        | Object | キーと値のハッシュオブジェクト
   *
   *   - date-time の場合
   *     - type          | String | 'date-time' 固定
   *     - dateTime      | String | 日時を表す文字列:
   *                     |        | - 2018-01-01T23:59:59
   *                     |        | - 2018-01-01T23:59
   *                     |        | - 2018-01-01T23
   *                     |        | - 2018-01-01
   *                     |        | - 2018-01
   *                     |        | - 2018
   *
   *   - date の場合
   *     - type          | String | 'date' 固定
   *     - date          | String | 日付を表す文字列
   *                     |        | - 2018-01-01
   *
   *   - time の場合
   *     - type          | String | 'time' 固定
   *     - time          | String | 時刻を表す文字列
   *                     |        | - 23:59:59
   *                     |        | - 23:59
   *                     |        | - 23
   *
   *   - raw の場合
   *     - type          | String | 'raw' 固定
   *     - raw           | String | EDT の 16 進数文字列
   *
   *   - array の場合
   *     - type          | String | 'array' 固定
   *     - array         | Object | リスト
   *
   *   - object の場合
   *     - type          | String | 'object' 固定
   *     - object        | Array  | オブジェクトだが意図的に Array で返す
   *
   * - 解析に失敗したら null を返す。
   * ---------------------------------------------------------------- */
  parsePropertyValue(
    pdata: any,
    edt_buf: any,
    epc_hex?: any,
    eoj_hex?: any,
    release?: any,
  ): any {
    if (epc_hex === 'B3') {
      this._debug = true;
    } else if (epc_hex && epc_hex !== 'B3') {
      this._debug = false;
    }

    if (!edt_buf || !Buffer.isBuffer(edt_buf)) {
      return null;
    }
    if (!pdata || typeof pdata !== 'object') {
      return null;
    }
    const oneof = pdata['oneOf'];
    if (oneof && Array.isArray(oneof)) {
      let data = null;
      // MRA の oneOf は定義順とは逆の順番で評価する。
      // そうしないと number の overflow や underflow と解釈されてしまう
      // 場合があるため。
      //for (let i = 0; i < oneof.length; i++) {
      for (let i = oneof.length - 1; i >= 0; i--) {
        const d = this.parsePropertyValue(oneof[i], edt_buf, epc_hex, eoj_hex);
        if (d !== null) {
          data = d;
          break;
        }
      }

      return data;
    }

    const type = pdata['type'];
    let edt_data = null;

    if (type === 'number') {
      edt_data = this._parsePropertyValueNumber(pdata, edt_buf);
    } else if (type === 'state') {
      edt_data = this._parsePropertyValueState(pdata, edt_buf);
    } else if (type === 'numericValue') {
      edt_data = this._parsePropertyValueNumericValue(pdata, edt_buf);
    } else if (type === 'level') {
      edt_data = this._parsePropertyValueLevel(pdata, edt_buf);
    } else if (type === 'bitmap') {
      edt_data = this._parsePropertyValueBitmap(pdata, edt_buf);
    } else if (type === 'date-time') {
      edt_data = this._parsePropertyValueDateTime(pdata, edt_buf);
    } else if (type === 'date') {
      edt_data = this._parsePropertyValueDate(pdata, edt_buf);
    } else if (type === 'time') {
      edt_data = this._parsePropertyValueTime(pdata, edt_buf);
    } else if (type === 'raw') {
      edt_data = this._parsePropertyValueRaw(pdata, edt_buf);
    } else if (type === 'array') {
      edt_data = this._parsePropertyValueArray(pdata, edt_buf);
    } else if (type === 'object') {
      edt_data = this._parsePropertyValueObject(
        pdata,
        edt_buf,
        eoj_hex,
        epc_hex,
      );
    } else if (type === 'bitmap') {
      edt_data = this._parsePropertyValueBitmap(pdata, edt_buf);
    }

    if (!edt_data) {
      return null;
    }

    if (epc_hex) {
      // 規格 Version 情報の場合はリリースバージョン情報を付加
      if (epc_hex === '82' && edt_data['raw'] && edt_data['raw'].length >= 6) {
        if (/^0EF0/.test(eoj_hex)) {
          // ノードプロファイルの場合
          // - 1バイト目：メジャーバージョン。2バイト目：マイナーバージョン。
          const v1 = parseInt(edt_data['raw'].substr(0, 2), 16);
          const v2 = parseInt(edt_data['raw'].substr(2, 2), 16);
          edt_data['release'] = v1.toString() + '.' + v2.toString();
        } else {
          // ノードプロファイルではない場合
          // - 1,2,4バイト目は0x00。3バイト目は機器オブジェクトのバージョンをASCIIで表す。
          const dec = parseInt(edt_data['raw'].substr(4, 2), 16);
          edt_data['release'] = String.fromCharCode(dec);
        }
      }

      // メーカーコードの場合はメーカー名情報を付加
      if (epc_hex === '8A' && edt_data['raw']) {
        const code = edt_data['raw'];
        const name_data = this._mManufacturerTable.get(code);
        if (name_data) {
          edt_data['manufacturerName'] = name_data;
        }
      }

      // 自ノードインスタンスリストS/インスタンスリスト通知の場合はインスタンスのクラス名情報を付加
      if (
        /^(D5|D6)$/.test(epc_hex) &&
        edt_data['object'] &&
        edt_data['object'] &&
        Array.isArray(edt_data['object'])
      ) {
        edt_data['object'].forEach(o => {
          if (o['name'] === 'instanceList') {
            o['array'].forEach((ins: any) => {
              const eoj = ins['raw'];
              const eoj_info = this._mDeviceDescription.getEoj(eoj);
              if (eoj_info) {
                ins['className'] = eoj_info['className'];
              }
            });
          }
        });
      }

      // プロパティマップの場合は EPC のプロパティ名情報を付加
      if (eoj_hex && /^(9D|9E|9F)$/.test(epc_hex) && edt_data['raw']) {
        const edt = edt_data['raw'];
        let epc_list = [];
        const num = parseInt(edt.substr(0, 2), 16);
        if (num > 0 && num < 16) {
          for (let i = 2; i < edt.length; i += 2) {
            epc_list.push(edt.substr(i, 2));
          }
        } else if (num >= 16 && edt.length === 17 * 2) {
          for (let byte_no = 0; byte_no < 16; byte_no++) {
            const hex_offset = (byte_no + 1) * 2;
            const byte = parseInt(edt.substr(hex_offset, 2), 16);
            for (let bit_no = 0; bit_no < 8; bit_no++) {
              if (byte & (1 << bit_no)) {
                const hex = (8 + bit_no).toString(16) + byte_no.toString(16);
                epc_list.push(hex.toUpperCase());
              }
            }
          }
          epc_list = epc_list.sort();
        }
        const property_list: any = [];
        const desc = this._mDeviceDescription.getEoj(eoj_hex, null, release);
        epc_list.forEach(epc_key => {
          let prop_desc = desc['elProperties'][epc_key];
          if (!prop_desc) {
            prop_desc = this._node_profile_desc['elProperties'][epc_key];
          }
          const epc_name = prop_desc ? prop_desc['propertyName'] : null;
          property_list.push({
            epc: epc_key,
            propertyName: epc_name,
          });
        });
        edt_data['propertyList'] = property_list;
      }
    }
    return edt_data;
  }

  _parsePropertyValueNumber(pdata: any, edt_buf: any) {
    const format = pdata['format'];
    if (!/u?int(8|16|32)$/.test(format)) {
      return null;
    }

    let v = null;
    const blen = edt_buf.length;
    const hex = edt_buf.toString('hex').toUpperCase();
    let special = null;

    if (format === 'int8') {
      if (blen >= 1) {
        v = edt_buf.readInt8(0);
      }
      if (hex === '80') {
        special = 'Under Flow';
      } else if (hex === '7F') {
        special = 'Over Flow';
      }
    } else if (format === 'int16') {
      if (blen >= 2) {
        v = edt_buf.readInt16BE(0);
      }
      if (hex === '8000') {
        special = 'Under Flow';
      } else if (hex === '7FFF') {
        special = 'Over Flow';
      }
    } else if (format === 'int32') {
      if (blen >= 4) {
        v = edt_buf.readInt32BE(0);
      }
      if (hex === '80000000') {
        special = 'Under Flow';
      } else if (hex === '7FFFFFFF') {
        special = 'Over Flow';
      }
    } else if (format === 'uint8') {
      if (blen >= 1) {
        v = edt_buf.readUInt8(0);
      }
      if (hex === 'FE') {
        special = 'Under Flow';
      } else if (hex === 'FF') {
        special = 'Over Flow';
      }
    } else if (format === 'uint16') {
      if (blen >= 2) {
        v = edt_buf.readUInt16BE(0);
      }
      if (hex === 'FFFE') {
        special = 'Under Flow';
      } else if (hex === 'FFFF') {
        special = 'Over Flow';
      }
    } else if (format === 'uint32') {
      if (blen >= 4) {
        v = edt_buf.readUInt32BE(0);
      }
      if (hex === 'FFFFFFFE') {
        special = 'Under Flow';
      } else if (hex === 'FFFFFFFF') {
        special = 'Over Flow';
      }
    }

    if (v !== null && special === null) {
      const min = 'minimum' in pdata ? pdata['minimum'] : null;
      if (min !== null) {
        if (v < min) {
          return null;
        }
      }
      const max = 'maximum' in pdata ? pdata['maximum'] : null;
      if (max !== null) {
        if (v > max) {
          return null;
        }
      }
    }

    if (v !== null) {
      if (pdata['multiple'] && typeof pdata['multiple'] === 'number') {
        const mo = pdata['multiple'];
        if (mo < 1) {
          const degit = mo.toString().replace(/^0\./, '').length;
          const n = Math.pow(10, degit);
          const mo2 = mo * n;
          v = (v * mo2) / n;
        } else {
          v = v * mo;
        }
      }
    }

    return {
      type: 'number',
      number: {
        format: pdata['format'],
        unit: pdata['unit'] || null,
        minimum: 'minimum' in pdata ? pdata['minimum'] : null,
        maximum: 'maximum' in pdata ? pdata['maximum'] : null,
        multiple: pdata['multiple'] || null,
        coefficient: pdata['coefficient'] || null,
        value: v,
        special: special,
      },
    };
  }

  _parsePropertyValueState(pdata: any, edt_buf: any) {
    const enum_list = pdata['enum'];
    if (!enum_list || !Array.isArray(enum_list)) {
      return null;
    }

    let v = null;

    const edt_hex = edt_buf.toString('hex').toUpperCase();
    for (let i = 0; i < enum_list.length; i++) {
      const en = enum_list[i];
      let ev = en['edt'];
      if (typeof ev === 'string') {
        ev = en['edt'].replace(/^0x/, '').toUpperCase();
      } else if (typeof ev === 'number') {
        ev = Buffer.from([ev]).toString('hex').toUpperCase();
      }
      //let st = en['state'];
      const st = en['descriptions'];
      if (!st || typeof st !== 'object') {
        continue;
      }
      if (edt_hex === ev) {
        v = st;
        break;
      }
    }

    if (v === null) {
      return null;
    } else {
      return {
        type: 'state',
        state: v,
      };
    }
  }

  _parsePropertyValueNumericValue(pdata: any, edt_buf: any) {
    const enum_list = pdata['enum'];
    if (!enum_list || !Array.isArray(enum_list)) {
      return null;
    }

    let v = null;

    const edt_hex = edt_buf.toString('hex').toUpperCase();
    for (let i = 0; i < enum_list.length; i++) {
      const en = enum_list[i];
      if (
        !en ||
        typeof en !== 'object' ||
        !en['edt'] ||
        typeof en['edt'] !== 'string'
      ) {
        continue;
      }
      const ev = en['edt'].replace(/^0x/, '').toUpperCase();
      const nv = en['numericValue'];
      if (edt_hex === ev) {
        v = nv;
        break;
      }
    }

    if (v === null) {
      return null;
    } else {
      return {
        type: 'numericValue',
        numericValue: v,
      };
    }
  }

  _parsePropertyValueLevel(pdata: any, edt_buf: any) {
    let base = pdata['base'];
    if (!base || /^0x[0-9a-fA-F]{2]$/.test(base)) {
      return null;
    }
    base = base.replace(/^0x/, '');
    base = parseInt(base, 16);

    const v = edt_buf.readUInt8(0) - base + 1;

    if ('maximum' in pdata) {
      if (v > pdata['maximum']) {
        return null;
      }
    }

    return {
      type: 'level',
      level: v,
    };
  }

  _parsePropertyValueBitmapDead(pdata: any, edt_buf: any): any {
    const size = pdata['size'];
    if (typeof size !== 'number') {
      return null;
    }
    const bitmaps = pdata['bitmaps'];
    if (!Array.isArray(bitmaps) || bitmaps.length === 0) {
      return null;
    }
    if (edt_buf.length < size) {
      return null;
    }

    const v: any = {};
    bitmaps.forEach(bm => {
      if (typeof bm !== 'object') {
        return;
      }

      const name = bm['name'];
      if (!name || typeof name !== 'string') {
        return;
      }

      const descs = bm['descriptions'];
      if (!descs || typeof descs !== 'object') {
        return;
      }

      const pos = bm['position'];
      if (!pos || typeof pos !== 'object') {
        return;
      }

      const idx = pos['index'];
      if (typeof idx !== 'number' || idx >= edt_buf.length) {
        return;
      }

      let msk = pos['bitMask'];
      if (typeof msk !== 'string' || !/^0b[01]{1,8}$/.test(msk)) {
        return;
      }
      msk = msk.replace(/^0b/, '');
      let bshift = 0;
      const msk_m = msk.match(/1(0+)$/);
      if (msk_m) {
        bshift = msk_m[1].length;
      }

      msk = parseInt(msk, 2);

      const val = bm['value'];
      if (!val || typeof val !== 'object') {
        return;
      }

      const byte = edt_buf.slice(idx, idx + 1).readUInt8(0);
      const masked_value = (byte & msk) >> bshift;
      const masked_value_buf = Buffer.from([masked_value]);
      v[name] = {
        descriptions: descs,
      };
      const o = this.parsePropertyValue(val, masked_value_buf);
      if (o) {
        for (const k in o) {
          v[name][k] = o[k];
        }
      }
    });
    if (Object.keys(v).length > 0) {
      return {
        type: 'bitmap',
        bitmap: v,
      };
    } else {
      return null;
    }
  }

  _parsePropertyValueDateTime(pdata: any, edt_buf: any) {
    let blen = 7;
    if (pdata['size']) {
      blen = pdata['size'];
    }
    if (edt_buf.length !== blen) {
      return null;
    }

    const parse_error = {
      type: 'date-time',
      dateTime: null,
    };

    let v = edt_buf.readUInt16BE(0);
    if (blen >= 3) {
      const M = edt_buf.readUInt8(2);
      if (M >= 1 && M <= 12) {
        v += '-' + ('0' + M).slice(-2);
      } else {
        return parse_error;
      }
    }
    if (blen >= 4) {
      const D = edt_buf.readUInt8(3);
      if (D >= 1 || D <= 31) {
        v += '-' + ('0' + D).slice(-2);
      } else {
        return parse_error;
      }
    }
    if (blen >= 5) {
      const h = edt_buf.readUInt8(4);
      if (h >= 0 || h <= 23) {
        v += 'T' + ('0' + h).slice(-2);
      } else {
        return parse_error;
      }
    }
    if (blen >= 6) {
      const m = edt_buf.readUInt8(5);
      if (m >= 0 || m <= 59) {
        v += ':' + ('0' + m).slice(-2);
      } else {
        return parse_error;
      }
    }
    if (blen >= 7) {
      const s = edt_buf.readUInt8(6);
      if (s >= 0 || s <= 59) {
        v += ':' + ('0' + s).slice(-2);
      } else {
        return parse_error;
      }
    }

    return {
      type: 'date-time',
      dateTime: v,
    };
  }

  _parsePropertyValueDate(_pdata: any, edt_buf: any) {
    if (edt_buf.length !== 4) {
      return null;
    }

    const parse_error = {
      type: 'date',
      date: null,
    };

    const Y = edt_buf.readUInt16BE(0);
    const M = edt_buf.readUInt8(2);
    const D = edt_buf.readUInt8(3);
    if (M < 1 || M > 12 || D < 1 || D > 31) {
      return parse_error;
    }

    const v = [Y.toString(), ('0' + M).slice(-2), ('0' + D).slice(-2)].join(
      '-',
    );

    return {
      type: 'date',
      date: v,
    };
  }

  _parsePropertyValueTime(pdata: any, edt_buf: any) {
    let blen = 3;
    if (pdata['size']) {
      blen = pdata['size'];
    }
    if (edt_buf.length !== blen) {
      return null;
    }

    const parse_error = {
      type: 'time',
      time: null,
    };

    let h = edt_buf.readUInt8(0);
    if (h < 0 || h > 23) {
      return parse_error;
    }

    h = ('0' + h).slice(-2);
    let v = h;

    if (blen >= 2) {
      const m = edt_buf.readUInt8(1);
      if (m >= 0 && m <= 59) {
        v += ':' + ('0' + m).slice(-2);
      } else {
        return parse_error;
      }
    }
    if (blen >= 3) {
      const s = edt_buf.readUInt8(2);
      if (s >= 0 && s <= 59) {
        v += ':' + ('0' + s).slice(-2);
      } else {
        return parse_error;
      }
    }

    return {
      type: 'time',
      time: v,
    };
  }

  _parsePropertyValueRaw(_pdata: any, edt_buf: any) {
    const v = edt_buf.toString('hex').toUpperCase();
    return {
      type: 'raw',
      raw: v,
    };
  }

  _parsePropertyValueBitmap(pdata: any, edt_buf: any): any {
    const blen = pdata['size'];
    if (!blen || edt_buf.length !== blen) {
      return null;
    }

    const list = [];
    for (const el of pdata['bitmaps']) {
      const index = el.position.index;
      const mask = el.position.bitMask.replace(/^0b/, '');
      const mask_num = parseInt(mask, 2);

      const mask_parts = mask.split('');
      let mask_shift = 0;
      for (const bit of mask_parts.reverse()) {
        if (bit === '0') {
          mask_shift++;
        } else {
          break;
        }
      }

      const edt_num = edt_buf[index];
      const bit_val = (edt_num & mask_num) >>> mask_shift;
      const pbuf = Buffer.from([bit_val]);
      const parsed_value = this.parsePropertyValue(el.value, pbuf);
      if (!parsed_value) {
        //err = true;
        //break;
        continue;
      }

      parsed_value.name = el.name;
      parsed_value.descriptions = {
        ja: el.descriptions.ja,
        en: el.descriptions.en,
      };
      list.push(parsed_value);
    }

    return {
      type: 'bitmap',
      bitmap: list,
    };
  }

  _parsePropertyValueArray(pdata: any, edt_buf: any): any {
    const items = pdata['items'];
    if (!items || typeof items !== 'object') {
      return null;
    }
    // array の一つの要素のバイト長を判定
    let item_len = pdata['itemSize'];
    if (!item_len) {
      item_len = this._determineByteLengthOfPropertyValue(items);
    }

    if (item_len === null) {
      return null;
    }

    const item_num = edt_buf.length / item_len;
    if (item_num % 1 !== 0) {
      return null;
    }

    const list: any[] = [];
    for (let i = 0; i < item_num; i++) {
      const offset = item_len * i;
      const ibuf = edt_buf.slice(offset, offset + item_len);
      const val = this.parsePropertyValue(items, ibuf);
      list.push(val);
    }

    return {
      type: 'array',
      array: list,
    };
  }

  _determineByteLengthOfPropertyValue(pdata: any, array_len?: any): any {
    const oneof = pdata['oneOf'];
    if (oneof) {
      return this._determineByteLengthOfPropertyValue(oneof[0]);
    }

    const type = pdata['type'];

    if (type === 'state' || type === 'bitmap') {
      const size = pdata['size'];
      if (size && typeof size === 'number' && size % 1 === 0) {
        return size;
      } else {
        return null;
      }
    } else if (type === 'numericValue') {
      const size = pdata['size'];
      if (size && typeof size === 'number' && size % 1 === 0 && size > 0) {
        return size;
      } else {
        return null;
      }
    } else if (type === 'number') {
      const format = pdata['format'];
      if (/^u?int8$/.test(format)) {
        return 1;
      } else if (/^u?int16$/.test(format)) {
        return 2;
      } else if (/^u?int32$/.test(format)) {
        return 4;
      } else {
        return null;
      }
    } else if (type === 'date-time') {
      if (pdata['size']) {
        return pdata['size'];
      } else {
        return 7;
      }
    } else if (type === 'date') {
      return 4;
    } else if (type === 'time') {
      if (pdata['size']) {
        return pdata['size'];
      } else {
        return 3;
      }
    } else if (type === 'raw') {
      if (
        pdata['minSize'] &&
        pdata['maxSize'] &&
        pdata['minSize'] === pdata['maxSize']
      ) {
        const s = pdata['minSize'];
        if (s && typeof s === 'number' && s % 1 === 0) {
          return s;
        } else {
          return null;
        }
      } else {
        return null;
      }
    } else if (type === 'level') {
      return 1;
    } else if (type === 'array') {
      if (!array_len) {
        if (
          pdata['minItems'] === pdata['maxItems'] &&
          typeof pdata['minItems'] === 'number'
        ) {
          array_len = pdata['minItems'];
        }
      }
      if (!array_len) {
        return null;
      }
      let s = pdata['itemSize'];
      if (!s || typeof s !== 'number' || s % 1 !== 0) {
        s = this._determineByteLengthOfPropertyValue(pdata['items']);
      }
      if (s === null) {
        return null;
      } else {
        const size = s * array_len;
        return size;
      }
    } else if (type === 'object') {
      const props = pdata['properties'];
      let size = 0;
      let err = false;
      props.forEach((p: any) => {
        const s = this._determineByteLengthOfPropertyValue(p);
        if (s === null) {
          err = true;
        } else {
          size += s;
        }
      });
      if (err) {
        return null;
      } else {
        return size;
      }
    } else {
      return null;
    }
  }

  _parsePropertyValueObject(
    pdata: any,
    edt_buf: any,
    eoj_hex: any,
    epc_hex: any,
  ): any {
    const props = pdata['properties'];
    if (!props || typeof props !== 'object') {
      return null;
    }

    const length_map: any = {};
    if (eoj_hex) {
      if (eoj_hex.startsWith('0602')) {
        // 0x0602: テレビ
        if (epc_hex === 'B3') {
          // 0xB3: 伝達文字列設定
          length_map['characterString'] = edt_buf.readUInt8(0);
        }
      }
    }

    let offset = 0;
    let err = false;
    let array_len = 0;

    const list: any[] = [];
    for (const p of props) {
      const name = p['shortName'];
      let s = null;
      if (name in length_map) {
        s = length_map[name];
      } else {
        s = this._determineByteLengthOfPropertyValue(p['element'], array_len);
      }

      if (s === null) {
        err = true;
        break;
      } else if (s === 0) {
        continue;
      } else if (offset + s > edt_buf.length) {
        err = true;
        break;
      } else {
        const pbuf = edt_buf.slice(offset, offset + s);
        const parsed_value = this.parsePropertyValue(p['element'], pbuf);
        if (!parsed_value) {
          //err = true;
          //break;
          continue;
        }
        parsed_value['name'] = name;
        parsed_value['shortName'] = name;
        parsed_value['elementName'] = {
          ja: p['elementName']['ja'],
          en: p['elementName']['en'],
        };
        list.push(parsed_value);
        offset += s;
        if (
          /^(numberOf|range)/.test(name) &&
          parsed_value['type'] === 'number'
        ) {
          array_len = parsed_value['number']['value'];
        } else {
          array_len = 0;
        }
      }
    }
    if (err) {
      return null;
    } else {
      return {
        type: 'object',
        object: list,
      };
    }
  }

  _convBufListToHexString(buf_list: any) {
    const hex_list: string[] = [];
    buf_list.forEach((buf: any) => {
      const hex = buf.toString('hex').toUpperCase();
      hex_list.push(hex);
    });
    return hex_list.join(' ');
  }
}

export default PacketParser;
