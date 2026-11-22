/* ------------------------------------------------------------------
 * パケット生成モジュール
 * ---------------------------------------------------------------- */
class PacketComposer {
  _ESV_MAP: any;
  _last_tid: any;
  error: any;
  constructor() {
    this.error = null;

    this._ESV_MAP = {
      SETI: 0x60,
      SETC: 0x61,
      GET: 0x62,
      INF_REQ: 0x63,
      SETGET: 0x6e,
      SET_RES: 0x71,
      GET_RES: 0x72,
      INF: 0x73,
      INFC: 0x74,
      INFC_RES: 0x7a,
      SETGET_RES: 0x7e,
      SETI_SNA: 0x50,
      SETC_SNA: 0x51,
      GET_SNA: 0x52,
      INF_SNA: 0x53,
      SETGET_SNA: 0x5e,
    };

    this._last_tid = 0;
  }

  /* ------------------------------------------------------------------
   * compose(params)
   * パケット生成
   *
   * 引数
   * - params       | object  | required |
   *   - tid        | integer | optional | 指定がなけれは自動採番
   *   - seoj       | string  | required | 16進数文字列 (例: "013001")
   *   - deoj       | string  | required | 16進数文字列 (例: "05FF01")
   *   - esv        | string  | required | ESV キーワード (例: "GET_RES") または 16進数文字列
   *   - properties | array   | required | object のリスト
   *     - epc      | string  | required | EPCの16進数文字列 (例: "80")
   *     - edt      | string  | optional | EDTの16進数文字列
   *
   * 戻値
   * - 生成に成功したら Buffer オブジェクトを返す。
   * - 生成に失敗したら null を返す。
   * - 失敗した場合は、本オブジェクトの error プロパティに Error オブジェクト
   *   がセットされる。
   * ---------------------------------------------------------------- */
  compose(params: any) {
    const buf_list: any[] = [];

    const ehd_buf = Buffer.from([0x10, 0x81]);
    buf_list.push(ehd_buf);

    let tid = (this._last_tid + 1) % 0xffff;
    if ('tid' in params) {
      const v = params['tid'];
      if (typeof v !== 'number' || v % 1 !== 0) {
        this.error = new Error('The parameter `tid` must be an integer.');
        return null;
      } else if (v < 0 || v > 0xffff) {
        this.error = new Error(
          'The parameter `tid` must be an integer between 0 and 0xffff.',
        );
        return null;
      }
      tid = v;
    }
    this._last_tid = tid;
    const tid_buf = Buffer.alloc(2);
    tid_buf.writeUInt16BE(tid, 0);
    buf_list.push(tid_buf);

    const seoj_buf = this._convHexToBuffer(params['seoj']);
    buf_list.push(seoj_buf);

    const deoj_buf = this._convHexToBuffer(params['deoj']);
    buf_list.push(deoj_buf);

    let esv = null;
    if ('esv' in params) {
      let v = params['esv'];
      if (!v || typeof v !== 'string') {
        this.error = new Error(
          'The parameter `esv` must be a non-empty string.',
        );
        return null;
      }
      v = v.toUpperCase();
      if (/^[0-9A-F][0-9A-F]$/.test(v)) {
        const num = parseInt(v, 16);
        let valid = false;
        Object.keys(this._ESV_MAP).forEach(keyword => {
          if (this._ESV_MAP[keyword] === num) {
            v = keyword;
            valid = true;
          }
        });
        if (valid === false) {
          this.error = new Error(
            'The value of the parameter `esv` is unknown: ' + v,
          );
          return null;
        }
      } else {
        if (!(v in this._ESV_MAP)) {
          this.error = new Error(
            'The value of the parameter `esv` is unknown: ' + v,
          );
          return null;
        }
      }
      esv = this._ESV_MAP[v];
    } else {
      this.error = new Error('The parameter `esv` is required.');
      return null;
    }
    const esv_buf = Buffer.from([esv]);
    buf_list.push(esv_buf);

    let err = null;

    if (esv === 0x5e) {
      // SETGET_SNA の場合
      const opc_buf = Buffer.from([0x00, 0x00]);
      buf_list.push(opc_buf);
    } else {
      // SETGET_SNA でない場合
      let prop_list = null;
      if ('properties' in params) {
        const p = params['properties'];
        if (!Array.isArray(p) || p.length === 0) {
          this.error = new Error(
            'The parameter `properties` must be a non-empty array.',
          );
          return null;
        }
        prop_list = p;
      } else {
        this.error = new Error('The paramter `properties` is required.');
        return null;
      }

      const opc_buf = Buffer.from([prop_list.length]);
      buf_list.push(opc_buf);

      prop_list.forEach(prop => {
        if (
          typeof prop['epc'] !== 'string' ||
          !/^[0-9A-F]{2}$/.test(prop['epc'])
        ) {
          err = new Error('The parameter `epc` is invalid.');
          return;
        }
        const epc_buf = this._convHexToBuffer(prop['epc']);
        if (!epc_buf) {
          err = new Error('The parameter `epc` is invalid.');
          return;
        }
        buf_list.push(epc_buf);

        const edt_buf = this._convHexToBuffer(prop['edt']);
        if (edt_buf) {
          const pdc_buf = Buffer.from([edt_buf.length]);
          buf_list.push(pdc_buf, edt_buf);
        } else {
          const pdc_buf = Buffer.from([0x00]);
          buf_list.push(pdc_buf);
        }
      });
    }

    if (err) {
      this.error = err;
      return null;
    }

    const buf = Buffer.concat(buf_list);
    return buf;
  }

  _convHexToBuffer(hex: any) {
    if (
      !hex ||
      typeof hex !== 'string' ||
      !/^[0-9a-fA-F]+$/.test(hex) ||
      hex.length % 2 !== 0
    ) {
      return null;
    }
    const byte_num = hex.length / 2;
    const num_list = [];
    for (let i = 0; i < byte_num; i++) {
      const n = parseInt(hex.substr(i * 2, 2), 16);
      num_list.push(n);
    }
    const buf = Buffer.from(num_list);
    return buf;
  }
}

export default new PacketComposer();
