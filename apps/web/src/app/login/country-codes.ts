export interface CountryDialCode {
  name: string;
  iso2: string;
  dialCode: string;
}

// Mã vùng điện thoại (ITU-T E.164) — dữ liệu tĩnh, hiếm khi đổi. Việt Nam
// đứng đầu vì đây là ngôn ngữ chính của dự án; còn lại xếp theo alphabet
// tên nước để dễ tìm trong <select> native trên di động.
export const COUNTRY_DIAL_CODES: readonly CountryDialCode[] = [
  { name: 'Việt Nam', iso2: 'VN', dialCode: '84' },
  { name: 'Afghanistan', iso2: 'AF', dialCode: '93' },
  { name: 'Algeria', iso2: 'DZ', dialCode: '213' },
  { name: 'Argentina', iso2: 'AR', dialCode: '54' },
  { name: 'Armenia', iso2: 'AM', dialCode: '374' },
  { name: 'Australia', iso2: 'AU', dialCode: '61' },
  { name: 'Áo (Austria)', iso2: 'AT', dialCode: '43' },
  { name: 'Azerbaijan', iso2: 'AZ', dialCode: '994' },
  { name: 'Bangladesh', iso2: 'BD', dialCode: '880' },
  { name: 'Belarus', iso2: 'BY', dialCode: '375' },
  { name: 'Bỉ (Belgium)', iso2: 'BE', dialCode: '32' },
  { name: 'Bolivia', iso2: 'BO', dialCode: '591' },
  { name: 'Brazil', iso2: 'BR', dialCode: '55' },
  { name: 'Brunei', iso2: 'BN', dialCode: '673' },
  { name: 'Bulgaria', iso2: 'BG', dialCode: '359' },
  { name: 'Cambodia', iso2: 'KH', dialCode: '855' },
  { name: 'Canada', iso2: 'CA', dialCode: '1' },
  { name: 'Chile', iso2: 'CL', dialCode: '56' },
  { name: 'Trung Quốc', iso2: 'CN', dialCode: '86' },
  { name: 'Colombia', iso2: 'CO', dialCode: '57' },
  { name: 'Croatia', iso2: 'HR', dialCode: '385' },
  { name: 'Cộng hoà Séc (Czechia)', iso2: 'CZ', dialCode: '420' },
  { name: 'Đan Mạch (Denmark)', iso2: 'DK', dialCode: '45' },
  { name: 'Ai Cập (Egypt)', iso2: 'EG', dialCode: '20' },
  { name: 'Estonia', iso2: 'EE', dialCode: '372' },
  { name: 'Phần Lan (Finland)', iso2: 'FI', dialCode: '358' },
  { name: 'Pháp (France)', iso2: 'FR', dialCode: '33' },
  { name: 'Đức (Germany)', iso2: 'DE', dialCode: '49' },
  { name: 'Hy Lạp (Greece)', iso2: 'GR', dialCode: '30' },
  { name: 'Hồng Kông (Hong Kong)', iso2: 'HK', dialCode: '852' },
  { name: 'Hungary', iso2: 'HU', dialCode: '36' },
  { name: 'Iceland', iso2: 'IS', dialCode: '354' },
  { name: 'Ấn Độ (India)', iso2: 'IN', dialCode: '91' },
  { name: 'Indonesia', iso2: 'ID', dialCode: '62' },
  { name: 'Iran', iso2: 'IR', dialCode: '98' },
  { name: 'Iraq', iso2: 'IQ', dialCode: '964' },
  { name: 'Ireland', iso2: 'IE', dialCode: '353' },
  { name: 'Israel', iso2: 'IL', dialCode: '972' },
  { name: 'Ý (Italy)', iso2: 'IT', dialCode: '39' },
  { name: 'Nhật Bản (Japan)', iso2: 'JP', dialCode: '81' },
  { name: 'Kazakhstan', iso2: 'KZ', dialCode: '7' },
  { name: 'Kenya', iso2: 'KE', dialCode: '254' },
  { name: 'Hàn Quốc (South Korea)', iso2: 'KR', dialCode: '82' },
  { name: 'Kuwait', iso2: 'KW', dialCode: '965' },
  { name: 'Lào', iso2: 'LA', dialCode: '856' },
  { name: 'Latvia', iso2: 'LV', dialCode: '371' },
  { name: 'Lithuania', iso2: 'LT', dialCode: '370' },
  { name: 'Malaysia', iso2: 'MY', dialCode: '60' },
  { name: 'Mexico', iso2: 'MX', dialCode: '52' },
  { name: 'Mông Cổ (Mongolia)', iso2: 'MN', dialCode: '976' },
  { name: 'Myanmar', iso2: 'MM', dialCode: '95' },
  { name: 'Nepal', iso2: 'NP', dialCode: '977' },
  { name: 'Hà Lan (Netherlands)', iso2: 'NL', dialCode: '31' },
  { name: 'New Zealand', iso2: 'NZ', dialCode: '64' },
  { name: 'Nigeria', iso2: 'NG', dialCode: '234' },
  { name: 'Na Uy (Norway)', iso2: 'NO', dialCode: '47' },
  { name: 'Pakistan', iso2: 'PK', dialCode: '92' },
  { name: 'Peru', iso2: 'PE', dialCode: '51' },
  { name: 'Philippines', iso2: 'PH', dialCode: '63' },
  { name: 'Ba Lan (Poland)', iso2: 'PL', dialCode: '48' },
  { name: 'Bồ Đào Nha (Portugal)', iso2: 'PT', dialCode: '351' },
  { name: 'Qatar', iso2: 'QA', dialCode: '974' },
  { name: 'Romania', iso2: 'RO', dialCode: '40' },
  { name: 'Nga (Russia)', iso2: 'RU', dialCode: '7' },
  { name: 'Ả Rập Xê Út (Saudi Arabia)', iso2: 'SA', dialCode: '966' },
  { name: 'Singapore', iso2: 'SG', dialCode: '65' },
  { name: 'Slovakia', iso2: 'SK', dialCode: '421' },
  { name: 'Nam Phi (South Africa)', iso2: 'ZA', dialCode: '27' },
  { name: 'Tây Ban Nha (Spain)', iso2: 'ES', dialCode: '34' },
  { name: 'Sri Lanka', iso2: 'LK', dialCode: '94' },
  { name: 'Thuỵ Điển (Sweden)', iso2: 'SE', dialCode: '46' },
  { name: 'Thuỵ Sĩ (Switzerland)', iso2: 'CH', dialCode: '41' },
  { name: 'Đài Loan (Taiwan)', iso2: 'TW', dialCode: '886' },
  { name: 'Thái Lan', iso2: 'TH', dialCode: '66' },
  { name: 'Thổ Nhĩ Kỳ (Turkey)', iso2: 'TR', dialCode: '90' },
  { name: 'Ukraine', iso2: 'UA', dialCode: '380' },
  { name: 'Các Tiểu Vương quốc Ả Rập Thống nhất (UAE)', iso2: 'AE', dialCode: '971' },
  { name: 'Anh (United Kingdom)', iso2: 'GB', dialCode: '44' },
  { name: 'Hoa Kỳ (United States)', iso2: 'US', dialCode: '1' },
  { name: 'Uzbekistan', iso2: 'UZ', dialCode: '998' },
  { name: 'Venezuela', iso2: 'VE', dialCode: '58' }
];

/**
 * Ghép mã vùng + số nội địa thành số E.164 (vd. "84" + "0912345678" →
 * "+84912345678"). Bỏ số 0 dẫn đầu và mọi ký tự không phải chữ số — cách
 * ghi số điện thoại nội địa phổ biến nhất mà user hay gõ nhầm khi có sẵn
 * bộ chọn mã vùng.
 */
export function toE164(dialCode: string, nationalNumber: string): string {
  const digitsOnly = nationalNumber.replace(/\D/g, '').replace(/^0+/, '');
  return `+${dialCode}${digitsOnly}`;
}
