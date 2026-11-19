// What a reader needs to know about a row before comparing it across years:
// how it is reported, and where the measuring stick itself distorts it.
// Bir satırı yıllar arası karşılaştırmadan önce bilinmesi gerekenler: nasıl
// raporlandığı ve ölçünün kendisinin nerede bozulma yarattığı.
export const ROW_NOTES = {
  '3C': {
    tr: 'Dönem içinde birikerek gelen bir akış kalemi. Çeyreklik görünümde yıllık rakamdan önceki çeyrekler çıkarılarak türetiliyor; çıkarma önce ortak enflasyon tabanına indekslenerek yapılıyor.',
    en: 'A flow line that accumulates through the year. The quarterly view derives it by subtracting earlier quarters, after indexing both to a common inflation base.',
  },
  '3D': {
    tr: 'Satış geliri eksi satışların maliyeti. Marj düşerken cironun yatay kalması, fiyatlamanın maliyet artışını karşılamadığı anlamına gelir.',
    en: 'Revenue less cost of sales. Flat revenue with a falling margin means pricing is not keeping up with costs.',
  },
  '3DF': {
    tr: 'Esas faaliyetten doğan kâr; finansman gelir-gideri ve kur farkı bunun dışında. Net kârdan daha az oynak olduğu için trend okumak için daha güvenli.',
    en: 'Profit from core operations, before financing items and FX. Less volatile than net profit, so a safer line to read a trend from.',
  },
  ebitda: {
    tr: 'Faaliyet kârına amortisman (4B satırı) geri eklenerek hesaplanıyor. Borçluluk oranlarının paydası olduğu için ayrıca önemli.',
    en: 'Operating profit with depreciation (line 4B) added back. It is also the denominator of the leverage ratios.',
  },
  '3Z': {
    tr: 'Azınlık payları ayrıldıktan sonra ortaklara kalan kâr. Kur farkı ve tek seferlik kalemler buraya düştüğü için en oynak satır.',
    en: 'Profit left to the parent after minority interests. The most volatile line, since FX and one-off items land here.',
  },
  grossMargin: {
    tr: 'Brüt kâr / satış geliri. Para biriminden bağımsız olduğu için üç bazda da aynı rakam.',
    en: 'Gross profit over revenue. Unit-free, so the same figure on all three bases.',
  },
  operatingMargin: {
    tr: 'Faaliyet kârı / satış geliri. Zarar dönemleri bu satırda negatife geçerek görünüyor.',
    en: 'Operating profit over revenue. Loss-making periods show up as negative here.',
  },
  netMargin: {
    tr: 'Net kâr / satış geliri. Kur farkını içerdiği için faaliyet marjından keskin ayrıştığı dönemler, finansman tarafına bakmak gerektiğini söyler.',
    en: 'Net profit over revenue. It carries FX, so a sharp gap from the operating margin points at the financing side.',
  },
  '2O': {
    tr: 'Toplam özkaynaktan azınlık payları düşülmüş hâli. Özkaynak kârlılığının paydası bu: payı olan net kâr da yalnızca ana ortaklığı gösteriyor.',
    en: 'Total equity less minority interests. This is the denominator of return on equity, because the net profit above it is parent-only too.',
  },
  roe: {
    tr: 'Ana ortaklık net kârı / ana ortaklık özkaynağı. Enflasyon düzeltmesi özkaynağı yukarı çektiği için düzeltmesiz yıllarla kıyaslanamaz.',
    en: 'Parent net profit over parent equity. Inflation accounting lifts equity, so it is not comparable with unadjusted years.',
  },
  '1BL': {
    tr: 'Dönem sonu fotoğrafı — biriken bir akış değil. Çeyreklik görünümde çıkarma yapılmaz, her çeyreğin kendi rakamı gösterilir.',
    en: 'A period-end snapshot, not an accumulating flow. The quarterly view shows each quarter as reported, with no subtraction.',
  },
  '1AA': {
    tr: 'Dönem sonu nakit. Net borcun hesabında finansal borçtan düşülüyor.',
    en: 'Period-end cash. It is netted off financial debt to get net debt.',
  },
  financialDebt: {
    tr: 'Kısa ve uzun vadeli finansal borcun toplamı (2AA + 2BA). Ticari borçlar bunun içinde değil.',
    en: 'Short and long-term financial debt (2AA + 2BA). Trade payables are not included.',
  },
  netDebt: {
    tr: 'Finansal borç eksi nakit. Borcun büyük kısmı dövizliyse dolar bazında bakmak daha anlamlı.',
    en: 'Financial debt less cash. If most of it is in foreign currency, the dollar basis is the more meaningful lens.',
  },
  '2N': {
    tr: 'Enflasyon muhasebesi sermaye kalemlerini yukarı düzelttiği için 2023 sonrası seride bir sıçrama görünür; bu şirketin kazandığı para değil, ölçünün değişmesi.',
    en: 'Inflation accounting restates capital upward, so the series jumps after 2023. That is the measuring stick changing, not money earned.',
  },
  '4C': {
    tr: 'Kârın nakde dönüp dönmediğini gösteren satır. Net kârdan sürekli ve belirgin şekilde düşük kalması, alacak ya da stok tarafında sıkışma işareti.',
    en: 'Whether profit turns into cash. Persistently far below net profit points at receivables or inventory.',
  },
  '4CAI': {
    tr: 'Negatif raporlanıyor. İşletme nakdine oranı, büyümenin ne kadarının içeriden finanse edildiğini söyler.',
    en: 'Reported negative. Against operating cash it shows how much of the growth is funded internally.',
  },
  '4CB': {
    tr: 'İşletme nakdi eksi yatırım, birikimli raporlanıyor. Yatırımın ağır olduğu çeyrekte düştüğü için rakama bakarak fotoğraf sanılabilir; satır koduna göre birikimli kabul ediliyor.',
    en: 'Operating cash less investment, reported cumulatively. It falls in a heavy-capex quarter and so looks like a snapshot; the item code decides, not the shape.',
  },
  '4CBB': {
    tr: 'Nakit çıkışı olduğu için negatif. Serbest nakit akımla karşılaştırıldığında dağıtımın sürdürülebilir olup olmadığını gösterir.',
    en: 'Negative, being a cash outflow. Against free cash flow it shows whether the payout is sustainable.',
  },
  '4BC': {
    tr: 'Bu satır raporlar arasında birim değiştirebiliyor — bir rapor tam lira, diğeri binlik veriyor. Gösterilmeden önce satış gelirine karşı doğrulanıp ölçekleniyor, tutturulamazsa atılıyor.',
    en: 'This line changes unit between reports — one states full lira, another thousands. It is reconciled against revenue before use and dropped when it cannot be.',
  },
  '4BD': {
    tr: 'Döviz geliri olan şirketlerde dolar merceğinin TÜFE merceğine yakın durması beklenir; ikisi ayrışıyorsa aradaki fark kurdan geliyor.',
    en: 'For an exporter the dollar lens should track the CPI lens; where they split, the gap is the exchange rate.',
  },
  exportShare: {
    tr: 'Yurtdışı satış / toplam satış. Kur hareketinin gelir tablosuna ne kadar geçtiğini tahmin etmek için ilk bakılacak satır.',
    en: 'Export sales over total sales. The first line to read when guessing how much an FX move reaches the income statement.',
  },
  '4BE': {
    tr: 'Dönem sonu fotoğrafı, akış değil. Negatif bakiye kur yükselişinde zarar, düşüşünde kâr yazdırır.',
    en: 'A period-end snapshot, not a flow. A negative balance books a loss when the currency weakens and a gain when it strengthens.',
  },
  '4BEB': {
    tr: 'Hedge pozisyonu dahil net döviz pozisyonu. Hedge hariç rakamla arasındaki fark korunan tutarı verir.',
    en: 'Net FX position including hedges. The gap from the unhedged line is the covered amount.',
  },
  netDebtEbitda: {
    tr: 'Net borç / FAVÖK: borcun kaç yıllık FAVÖK ettiği. Para biriminden bağımsız olduğu için üç bazda da aynı.',
    en: 'Net debt over EBITDA: how many years of EBITDA the debt amounts to. Unit-free, so the same on all three bases.',
  },
};

export const KIND_NOTES = {
  flow: {
    tr: 'Dönem içinde birikerek gelen bir akış kalemi; çeyreklik görünüm önceki çeyrekler çıkarılarak türetiliyor.',
    en: 'A flow line that accumulates through the year; the quarterly view is derived by subtracting earlier quarters.',
  },
  stock: {
    tr: 'Dönem sonu fotoğrafı; her kolon o dönemin kendi rakamı.',
    en: 'A period-end snapshot; each column is that period as reported.',
  },
};

// Rows worth offering as a next step from the selected one.
// Seçili satırdan sonra bakılması anlamlı olan satırlar.
export const RELATED = {
  '3C': ['3D', '4BD', '3DF'],
  '3D': ['3C', 'grossMargin', '3DF'],
  '3DF': ['ebitda', '3Z', 'operatingMargin'],
  ebitda: ['3DF', 'netDebt', '4C'],
  '3Z': ['3DF', 'netMargin', '2N'],
  grossMargin: ['3D', '3C', 'operatingMargin'],
  operatingMargin: ['3DF', 'grossMargin', 'netMargin'],
  netMargin: ['3Z', 'operatingMargin'],
  roe: ['3Z', '2O'],
  '1BL': ['2N', 'financialDebt'],
  '1AA': ['netDebt', '4C'],
  financialDebt: ['netDebt', '2N'],
  netDebt: ['financialDebt', '1AA', 'ebitda'],
  '2N': ['1BL', '2O'],
  '2O': ['2N', 'roe'],
  '4C': ['3Z', '4CB', '4CAI'],
  '4CAI': ['4C', '4CB'],
  '4CB': ['4C', '4CAI', '4CBB'],
  '4CBB': ['4CB', '3Z'],
  '4BC': ['4BD', '3C'],
  '4BD': ['4BC', 'exportShare'],
  exportShare: ['4BD', 'netMargin'],
  '4BE': ['4BEB', 'netMargin'],
  '4BEB': ['4BE', 'netDebt'],
  netDebtEbitda: ['netDebt', 'ebitda'],
};

// Which direction is the good one for each row. Without this a chart can only
// read the sign, and the sign means opposite things on a profit row and a debt
// row: a negative net debt is net cash, not a loss.
//
// `false` means lower is better. `null` means the row has no good direction, so
// nothing about it gets coloured -- either because the figure is neutral
// (total assets, export share) or because the same sign arrives two ways. Net
// Debt / EBITDA is the second kind: it goes negative when net debt is negative
// (net cash, good) and also when EBITDA is negative (losing money, bad). A
// wrong green is worse than a grey, so it stays null. A key missing from the
// map is treated as null.
//
// Her satırda iyi olan yön hangisi. Bu olmadan grafik yalnız işarete bakabilir,
// işaret ise kâr satırıyla borç satırında zıt şey anlatıyor: negatif net borç
// zarar değil, net nakit.
//
// `false` düşük olanın iyi olduğu demek. `null` satırın iyi bir yönü yok demek,
// o zaman hiçbir şeyi renklenmiyor -- ya rakam nötr olduğu için (toplam
// varlıklar, ihracat payı) ya da aynı işaret iki ayrı yoldan geldiği için. Net
// Borç/FAVÖK ikincisi: net borç negatifken de (net nakit, iyi) FAVÖK negatifken
// de (zarar, kötü) negatife düşüyor. Yanlış bir yeşil griden kötü olduğu için
// null kalıyor. Haritada olmayan anahtar null sayılıyor.
const ROW_POLARITY = {
  '3C': true,
  '3D': true,
  '3DF': true,
  ebitda: true,
  '3Z': true,
  grossMargin: true,
  operatingMargin: true,
  netMargin: true,
  roe: true,
  '1BL': null,
  '1AA': true,
  financialDebt: false,
  netDebt: false,
  '2N': true,
  '2O': true,
  '4C': true,
  // Reported as an outflow, and spending more is neither good nor bad on its own.
  // Çıkış olarak raporlanıyor, çok harcamak tek başına ne iyi ne kötü.
  '4CAI': null,
  '4CB': true,
  '4CBB': null,
  '4BC': true,
  '4BD': true,
  exportShare: null,
  // A short FX position is what a falling lira hurts, so a bigger one is better.
  // Kısa döviz pozisyonu düşen liranın vurduğu yer, yani büyüğü daha iyi.
  '4BE': true,
  '4BEB': true,
  netDebtEbitda: null,
};

export function polarityOf(key) {
  const value = ROW_POLARITY[key];
  return value === undefined ? null : value;
}

// Turns a rise or fall into a colour, given the row's direction: the same +12%
// is green on revenue and red on net debt, and grey where there is no good
// direction.
// Bir artışı ya da düşüşü satırın yönüne göre renge çeviriyor: aynı +%12 ciroda
// yeşil, net borçta kırmızı, iyi yönü olmayan satırda gri.
export function deltaColor(up, key) {
  const good = polarityOf(key);
  if (good == null || up == null) return 'var(--text-dim)';
  return up === good ? 'var(--up)' : 'var(--down)';
}

// The class for a value cell, by the same rule the bars use: mark the sign only
// where it tells the reader something, and in the direction the row means.
// Bir değer hücresinin sınıfı, çubukların kullandığı kuralla aynı: işareti
// yalnız okura bir şey söylediği yerde ve satırın kastettiği yönde işaretle.
export function signClass(value, key) {
  const good = polarityOf(key);
  if (good == null || value == null || value >= 0) return '';
  return good ? 'is-neg' : 'is-up';
}

// The class for a change cell: a rise is good only when the row says so.
// Bir değişim hücresinin sınıfı: artış ancak satır öyle diyorsa iyi.
export function changeClass(up, key) {
  const good = polarityOf(key);
  if (good == null || up == null) return '';
  return up === good ? 'is-up' : 'is-neg';
}
