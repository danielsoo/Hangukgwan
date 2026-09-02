const MAIN_ADDR_ZH = '新竹縣竹北市縣政九路135巷32號'
const BRANCH_ADDR_ZH = '新竹縣竹北市太元一街7號'

export function useTranslatedInfo() {
  return {
    mainMapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(MAIN_ADDR_ZH)}`,
    branchMapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(BRANCH_ADDR_ZH)}`,
  }
}
