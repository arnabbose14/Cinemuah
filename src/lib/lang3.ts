export const LANG3: Record<string, string> = {
  eng: 'English', spa: 'Spanish', fra: 'French', fre: 'French', deu: 'German', ger: 'German', ita: 'Italian',
  por: 'Portuguese', rus: 'Russian', jpn: 'Japanese', kor: 'Korean', zho: 'Chinese', chi: 'Chinese',
  hin: 'Hindi', ara: 'Arabic', tur: 'Turkish', pol: 'Polish', nld: 'Dutch', dut: 'Dutch', swe: 'Swedish',
  tha: 'Thai', vie: 'Vietnamese', ind: 'Indonesian', ben: 'Bengali', tam: 'Tamil', tel: 'Telugu', urd: 'Urdu',
  heb: 'Hebrew', ell: 'Greek', gre: 'Greek', ces: 'Czech', cze: 'Czech', hun: 'Hungarian', ron: 'Romanian',
  nor: 'Norwegian', dan: 'Danish', fin: 'Finnish', ukr: 'Ukrainian',
};

/** Human name for an ISO 639-2 audio language code ('' when unknown). */
export const langName = (code: string): string => LANG3[code?.toLowerCase()] || (code ? code.toUpperCase() : '');
