import { describe, expect, it } from 'vitest';
import { Validator } from '../src/core/validate.js';
import { DEFAULT_CONFIG } from '../src/core/config.js';

const validator = new Validator({
  ...DEFAULT_CONFIG.validation,
  allowLatin: false,
  blocklist: ['금지어'],
});

describe('Validator', () => {
  it('정상 단어를 통과시킨다', () => {
    expect(validator.validate('벤티').ok).toBe(true);
    expect(validator.validate('리제로부터시작하는이세계생활').ok).toBe(true);
  });

  it('빈 문자열을 거른다', () => {
    expect(validator.validate('')).toMatchObject({ ok: false, code: 'empty' });
  });

  it('문장부호만 있는 문자열을 거른다', () => {
    expect(validator.validate('...')).toMatchObject({ ok: false, code: 'punctuation_only' });
  });

  it('너무 짧은 단어를 거른다', () => {
    expect(validator.validate('컵')).toMatchObject({ ok: false, code: 'too_short' });
  });

  it('너무 긴 단어를 거른다', () => {
    expect(validator.validate('가'.repeat(41))).toMatchObject({ ok: false, code: 'too_long' });
  });

  it('허용되지 않은 문자를 거른다', () => {
    expect(validator.validate('벤티!')).toMatchObject({ ok: false, code: 'illegal_characters' });
    expect(validator.validate('벤티abc')).toMatchObject({
      ok: false,
      code: 'illegal_characters',
    });
  });

  it('끝말잇기로 이을 수 없는 표기를 거른다', () => {
    const digits = new Validator({ ...DEFAULT_CONFIG.validation, allowLatin: false });
    expect(digits.validate('응답하라1988')).toMatchObject({ ok: false, code: 'no_chain_tail' });
  });

  it('차단 목록을 적용한다', () => {
    expect(validator.validate('금지어')).toMatchObject({ ok: false, code: 'blocked' });
  });
});
