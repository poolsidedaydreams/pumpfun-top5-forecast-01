# BUILD_LOG — pumpfun-top5-forecast-01, entry v4

Tanggal: 2026-11-12. Builder: worker builder v4, sesi `c3d111df`
(koordinator v4 `998c6784`). Bahasa: Indonesia. Log ini adalah catatan
jujur: validasi scorer, diagnosis kesalahan v1/v3 yang tersisa, setiap
ablasi (diterima dan ditolak, dengan angka), sumber GitHub yang dipakai
dan ditolak beserta lisensinya, kelemahan tersisa, asumsi yang belum
terjawab, proyeksi server dengan haircut, dan handoff v5. Tidak ada
yang di-submit, ditandatangani, atau di-push oleh sesi ini (dilarang);
direktori entry hanya berisi `main.ts`, `LICENSE`, dan file ini.

## 0. Apa itu v4

Mesin Monte Carlo yang sama dengan v1/v2/v3 (path log-cap per koin
dengan saturasi momentum tau=2 jam, sigma venue×√h dicap 1,0, hazard
fade, lompatan graduasi, ceiling kurva 2,55, plus medan pendatang
sintetis yang jumlahnya diskala horizon dan dicap 200), dengan TIGA
perubahan di atas v3. Semua yang tidak disebut di §1 adalah v3 verbatim,
termasuk fit fade (byte-for-byte v1/v2), estimator drift/vol/graduasi,
seleksi kandidat, greedy naming, optimiser assignment top-5, 40.000
sims, seed `0x9e3779b9`, dan skala pendatang×horizon.

Tiga perubahan v4 (masing-masing lolos ablasi berpasangan; bukti di §4):

1. **V4-1 — Perbaiki span laju arrival (BUG estimator).** Span =
   selisih mark recent pertama–terakhir DITAMBAH satu kadens (median gap
   antar-mark); bila hanya ada 1 mark recent, span = kadens. Floor
   pembagi 0,25 jam dan cap 60/jam dipertahankan. Ini perbaikan
   kebenaran matematis estimator, bukan tuning: pendatang yang pertama
   terlihat di mark recent pertama tiba selama interval SEBELUMNYA.
2. **V4-2 — Cap pendatang dari distribusi pool-only.** `peakCaps`
   kini hanya observasi muda (<1 jam) ber-venue pool/migrating dari
   koin yang pernah mencapai top-20; fallback ke distribusi campuran
   bila nol observasi pool. Ekstensi ekor (peluang 0,15, skala
   eksponensial 0,25) tidak berubah.
3. **V4-3 — Bobot campuran size = u (REVERT perubahan #3 v3).**
   Campuran histogram size memakai massa unnamed order `u` seperti
   v1/v2, bukan frekuensi sim `simNew`.

Yang DIPERTAHANKAN dari v3 (dengan bukti, §4): lag-fit repair, sparse-
mark exclusion, gated blend 0,30·h/(h+2), kernel smoothing
[0,25;0,5;0,25], pooled trend + guard min-2, fade Old + prior
{0,55;2} (JANGAN PERNAH diubah — fade-new −4,43), greedy naming +
rescale v1, trend caps/shrinkage, 40.000 sims, NEWCOMER_CAP 200,
ARRIVAL_CAP 60, GRAD_MEAN fallback 2,9, u=max.

## 1. Validasi scorer (sebelum perbandingan apa pun dipercaya)

Scorer/backtest disalin dari `pumpfun-v3-work/` (baca saja) ke scratch
`pumpfun-v4-work/build/`; md5 salinan cocok dengan sumber dan dengan
VERIFY.md: `scorer.mjs` = `45e9e362e92a5ff927d2c3df65b73100`,
`backtest.mjs` = `f872bb2a9a6d357a7fa596675adc070f`. Protokol: train
mark 0..cut, test mark berikutnya sebagai pseudo-read, entry dijalankan
via `MAKEFUN_INPUT_DIR`/`MAKEFUN_OUTPUT_DIR`, tertimbang cuts 2–4
(6 reads).

| entri | cut 2 (ord/size) | cut 3 (ord/size) | cut 4 (ord/size) | tertimbang 2–4 |
|---|---|---|---|---|
| baseline (starter) | −49,958 (−26,249/−23,709) | −33,478 (−18,589/−14,889) | −29,867 (−15,246/−14,621) | −41,116 |
| v1 | −42,891 (−24,242/−18,649) | −25,580 (−16,278/−9,302) | −25,352 (−14,267/−11,085) | −34,197 |
| v2 | −44,883 (−25,296/−19,586) | −27,311 (−16,713/−10,598) | −26,051 (−13,720/−12,331) | −35,887 |
| v3 | −40,595 (−24,101/−16,494) | −26,492 (−16,587/−9,905) | −25,783 (−14,128/−11,655) | −33,425 |
| **v4 (inti)** | **−32,661 (−21,445/−11,216)** | **−26,866 (−16,318/−10,548)** | **−25,427 (−14,618/−10,808)** | **−29,524** |

Angka baseline/v1/v2/v3 direproduksi PERSIS (3 desimal) oleh sesi ini
di 40k sims (v1 memakai 6.000 sims bawaannya) — scorer dinyatakan
valid. Baris "v4 (inti)" di tabel adalah kombinasi inti T5 SEBELUM
aspek plus (verifikasi #3): `main.ts` pada tahap itu mereproduksi T5
harness PERSIS. File FINAL (inti + GPD + OU, §4.2.2) mencetak
**−29,383** — lihat §6. `forecast.json` inti byte-identik dengan
harness T5 di ketiga cut
(md5 cut 2 `4fdd7e98…`, cut 3 `9149381a…`, cut 4 `bf31590f…`).
Diff tekstual `main.ts` v4 vs v3 menunjukkan HANYA komentar header +
lima perubahan kode yang dimaksud (§0) — tidak ada perbedaan perilaku
lain.

Konteks server (bukan lokal; terverifikasi parent via GET langsung):
skor practice v1 = −38,03 (order −20,05 / size −17,98), v3 = −37,31
(order −20,40 / size −16,91); cutoff 10 besar ≈ −33,7 (papan publik
tidak dapat diakses — angka lama dari koordinator v3, v1 peringkat
178/314). Jurang hadiah dari v3 ≈ 3,6 nats.

## 2. Diagnosis: kesalahan yang TERSISA di v1/v3 (ringkasan)

Sumber lengkap: `pumpfun-v4-work/diag/DIAGNOSIS.md` (885 baris) +
`pumpfun-v4-work/verify-diag/VERIFY.md` (reproduksi independen: SEMUA
angka headline dan 25+ ablasi cocok persis). Ringkasan mekanistis:

- **Bug span arrival (§2.3 DIAGNOSIS).** Fallback `spanH=1` saat hanya
  1 mark recent membuat laju cut-2 = 15/jam vs benar ~90/jam (cap 60);
  span juga kehilangan satu kadens di cut 3/4 (tetapi cap 60 sudah
  mengikat di sana). Perbaikan span adalah koreksi definisi laju =
  entrants / lebar jendela kedatangan. Di final 66-mark, fallback tidak
  terpicu dan efeknya kecil (~3%) — jangan oversell.
- **Medan newcomer: distribusi cap campuran menipiskan urutan
  ke-2..ke-5.** `peakCaps` campuran: n=192, median 1,63, hanya 19%
  observasi pool; cap kurva tidak pernah melewati 2,52 (n=885).
  Ke-16 slot NEW terealisasi (dari 30 slot) adalah peluncuran
  pasca-cut, venue pool, cap 3,10–3,56. Dengan N draw kecil, max dari
  campuran ≈ max dari ~N×g draw lulusan — cukup untuk place 1, gagal
  untuk place 2–5. `simNew` v3 (0,03–0,23) jauh di bawah share
  terealisasi (0,20–0,80). Pool-only memperbaiki statistik urutan
  secara mekanis (di N=10: pool 3,39/3,29/3,23/3,16/3,09 vs campuran
  3,00/2,54/2,16/1,90/1,73).
- **Order didominasi slot NEW; greedy naming adalah pagar
  sesungguhnya.** 16 slot NEW × ln ≈ −5,3 + 14 slot old × ln ≈ −2,4.
  Cakupan kandidat SEMPURNA; penghentian greedy (bukan u) menentukan
  massa unnamed output (melebihi u sebesar 0,03–0,25). Rescale keras
  ke tepat 1−u merugikan (−0,74).
- **Size: gradien place terlalu curam; rezim kompresi tidak
  tertangkap.** Forecast spread cut-2 0,73 vs terealisasi 0,28;
  kerugian size terkonsentrasi di place 4–5 read terjauh. Perbaikan
  medan adalah rute prinsipiil; kompresi gradien ad hoc ditolak.
- **Mekanisme order server −0,35 (VERIFY.md §5.3, TERBUKTI
  bentuknya).** Tidak satu pun dari 6 perubahan v3 dapat menjelaskan
  penurunan order server secara mekanis di splits (tiga perubahan
  size-only terbukti order-netral 0,000 persis; lag-fit justru
  membantu +0,56). Kandidat yang tersisa: divergensi fit newcomer
  per-place yang AKTIF di histori penuh (v3: fit per-place fInf
  0,65–0,78, tau 0,36–0,41, uPlace 0,74–0,77) tetapi TIDAK PERNAH
  menyala di v1 (prior persis (0,5; 2,0), uPlace 0,60–0,63) —
  divergensi ini tidak ada di splits, itulah mengapa −0,35 tidak
  tereproduksi lokal — DITAMBAH noise satu-draw practice (7 reads
  berkorelasi, n efektif ≈ 1–2). Builder DILARANG "memperbaiki" order
  dengan revert perubahan v3: tidak ada target revert yang valid.
  Satu-satunya perbaikan order yang didukung bukti adalah medan
  newcomer yang lebih kuat + span fix.
- **Bias server-vs-lokal ~3,9 nats, 88–97% size.** Level lokal terlalu
  optimistis pada kedua entry; selisih antar-entry jauh lebih stabil
  (delta bias total −0,06). Keputusan v4 HANYA dari selisih
  berpasangan; level absolut di-haircut ~3,9 nats saat memproyeksikan
  server (§9). Bias tidak bisa dikoreksi dari data lokal.
- **Yang TIDAK rusak:** fade fit/prior (load-bearing), ceiling kurva
  2,55 (tervalidasi), seleksi kandidat + greedy + assignment top-5,
  determinisme/runtime/ukuran output.

## 3. Skor lokal + statistik berpasangan + DM-HLN

Headline 40k (6 reads, tertimbang cuts 2–4):

| perbandingan | Δ log (mean) | SD / SE | t | menang | CI95 (naif) | Δ order | Δ size |
|---|---|---|---|---|---|---|---|
| v4 − v1 | +4,673 | 6,791 / 2,772 | 1,69 | 4/6 | [−0,76; +10,11] | +1,326 | +3,347 |
| v4 − v3 | +3,902 | 5,336 / 2,178 | 1,79 | 5/6 | [−0,37; +8,17] | +1,336 | +2,566 |
| v4 − v2 | +6,363 | 7,296 / 2,979 | 2,14 | 5/6 | [+0,53; +12,20] | +1,908 | +4,456 |

Per-read v4−v3 (log): +5,36 / +7,43 / +11,01 / −4,12 / +3,37 / +0,36.
Gain TERKONSENTRASI di cut 2 (rezim newcomer 0,80; +7,93); di cut 3
kombinasi ini KALAH 0,37 dari v3. Agreement: v4 48 vs v1/v2/v3 45.

Uji DM-HLN offline (pagar sekunder, bukan gate tunggal; loss =
−log-score per read; LRV Bartlett + koreksi HLN; implementasi
`build/dm.mjs`, adaptasi rumus dieboldmariano MIT):

| perbandingan | h=1: DM-HLN / p | h=2: DM-HLN / p |
|---|---|---|
| v4 vs v3 | 1,79 / 0,133 | 1,58 / 0,174 |
| v4 vs v1 | 1,69 / 0,153 | 1,30 / 0,250 |
| v3 vs v1 (kontrol) | 0,86 / 0,430 | 0,60 / 0,572 |

Tidak ada perbandingan yang signifikan pada 5%. Dengan n=6 reads
berkorelasi + ≥116 konfigurasi yang diseleksi pada reads yang sama
(ledger §4.3), CI naif tidak valid pasca-seleksi dan angka "terbaik"
mengandung winner's curse. Penilaian jujur ada di §9 — v4 BUKAN
"jelas lebih baik" secara statistik.

## 4. Ablasi

### 4.1 Ablasi inti v4 (dari program diagnosis; kontrol 12k −33,390 kecuali dinyatakan 40k)

| id | varian | skor (Δ vs kontrol) | putusan |
|---|---|---|---|
| A1 | SPAN=cadence | −32,216 (+1,175) | ADOPSI (V4-1). Seluruh gain di cut 2; cut 3/4 identik (cap mengikat). |
| A6 | CAPSRC=poolonly | −30,638 (+2,752) | ADOPSI (V4-2). Gain cut 2 +5,67; cut 3 −0,41; cut 4 +0,32. |
| A11 | SPAN+poolonly (12k) | −29,539 (+3,852) | Kombinasi; ~aditif. Per-read t 1,77, 5/6, CI95 [−0,40; +8,11]. |
| R3/B1 | SIZEW=u (basis v3) | −33,053 (+0,337) | ADOPSI (V4-3). t 1,62, 5/6. Netral di basis kuat (E10 +0,004). |
| E10 | A11+SIZEW-u (12k) | −29,535 | Netral di basis kuat — asimetri menguntungkan u. |
| T5 | SPAN+poolonly+SIZEW-u (40k) | **−29,524** (+3,902 vs v3) | KOMBINASI INTI v4, direproduksi persis oleh `main.ts` (§1). |
| E4 | POOLRATE+poolonly+SPAN | −31,096 (+2,29) | Ditolak sebagai utama: jujur tapi terlalu tipis. Premi overcounting A11−E4 +1,56 TIDAK signifikan (t 1,06, CI95 [−1,32; +4,44]). |
| E6/E7 | MIXG(+CAP120)+SPAN | −31,121 / −31,026 | Alternatif jujur terdokumentasi; kalah dari A11 dalam noise. |
| E8 | A11+CAP120 | −30,035 (−0,50 vs A11) | DITOLAK: over-hedge di cut 3/4. |
| R1 | FIT=v1 (revert lag-fit) | −33,954 (−0,56) | PERTAHANKAN repair v3. |
| R2 | SPARSE=include | −33,339 (+0,05) | PERTAHANKAN exclusion (prinsipil, ~gratis). |
| R4a/R4b | blend none / datar 0,25 | −33,293 / −34,038 | PERTAHANKAN gated (vs datar +0,65, t 7,82, 6/6). |
| R5 | smoothing none | −33,446 (−0,06) | PERTAHANKAN kernel (asuransi; +0,19 di basis A11). |
| R6 | TREND=v1 | −34,800 (−1,41) | PERTAHANKAN pooled+min-2 (gain = guard cut-2; pooling atas prinsip). |
| T3 | FADE=new | −37,817 (−4,43) | DITOLAK TEGAS. Fade Old dipertahankan. |
| T4 | SIMS 80k | −33,415 (+0,01 vs 40k) | PERTAHANKAN 40k. |
| C1 | GREEDY=rescale | −34,132 (−0,74) | DITOLAK. |
| C5/C6 | U=sim / U=mean | −33,986 / −33,569 | DITOLAK. U-mean: split +0,26 di basis A11 TAPI memangkas pagar unnamed horizon panjang p1 0,78→0,49. |
| D2 | TREND=off | −35,382 (−1,99) | DITOLAK. Tren load-bearing. |
| C11/E17 | P0 naming | +0,02 | DITOLAK: gain ~nol vs risiko floor −9,21 per slot. |
| D1/E16 | GRAD empiris | −0,18 / +0,10 | Noise; pertahankan fallback 2,9. |
| B2–B4, B5–B16, C2–C4, C7–C10, C12–C13, D3–D8, A4/A5/A7–A10/A12 | bobot campuran lain, varian smoothing/blend, greedy factor, U-cap, place weight, grid fit, cap/tren/tau/sigma, sumber cap lain, ekor | ±0,08 s.d. +0,24, sebagian besar netral/inert | DITOLAK / dipertahankan nilai v3. Detail penuh di DIAGNOSIS.md §4 + §9. |

PERINGATAN FRAGILITAS (wajib dibaca): gain cut-2 poolonly bersandar
pada HANYA 4 observasi pool (n=4, cap 2,64–3,11). Di histori penuh
n=36; di final 66-mark n akan jauh lebih besar — fragilitas mengecil
dengan skala, tetapi gain split cut-2 harus dibaca dengan haircut
(§9). Uji transfer sintetis (dinamika OU + kelas + crash, BUKAN
validasi): keunggulan sumber cap TIDAK mentransfer (selisih ≤0,11
nats) dan v3 kalah dari sebaran merata di horizon panjang sintetis —
peringatan transfer yang jujur, bukan vonis (rezim sintetis ≠ rezim
final).

### 4.2 Ablasi aspek plus (40k, baseline = kombinasi inti v4 −29,524; gate adopsi: mean positif + mekanisme masuk akal + bentuk horizon panjang bersih)

Semua varian dibangun sebagai salinan `main.ts` dengan SATU perubahan
(skrip `build/mkvariant.py`, patch ditegaskan single-hit). Baseline
inti adalah `main.ts` final sesi ini.

| id | varian | skor (Δ vs inti) | paired (mean / t / menang) | putusan |
|---|---|---|---|---|
| P1 | Log-pool berlantai (1e-12) ganti blend linear, lalu renormalisasi | −29,387 (**+0,137**) | +0,136 / t 5,23 / **6/6**, CI95 [+0,09; +0,19]; order persis 0,000 (size-only deterministik) | **ADOPSI — menunggu cek horizon panjang** (lihat §4.2.1) |
| P2a | KDE Silverman (h pooled, binned Gaussian) ganti kernel diskrit | −29,618 (−0,094) | −0,094 / t −0,85 / 3/6 | DITOLAK |
| P2b | KDE Silverman 2h | −29,571 (−0,048) | −0,048 / t −0,42 / 2/6 | DITOLAK |
| P3a | Antithetic: reseed per-sim + mirror (kontrol reseed saja: −29,493, +0,031 = noise stream) | −29,504 (−0,011 vs kontrol reseed) | −0,011 / t −1,20 / 3/6, CI95 [−0,03; +0,01] | DITOLAK. Efek ≈ nol seperti diprediksi: noise MC sudah ~0,02–0,03 nats di 40k. Desain mirror benar (negasi di level `randn` + mirror uniform langsung, `randn` memakai stream mentah) — bukan bug implementasi. |
| P3b | Spike kelahiran di log-cap 1,447, w=0,10 (struktur curve) | −29,439 (+0,085) | +0,085 / t 0,71 / 3/6, CI95 [−0,15; +0,32]; didorong 1 read (+0,63), c2r3 −0,26 | DITOLAK: tidak konsisten, level noise. |
| P3c | Spike kelahiran, w=0,25 | −29,409 (+0,114) | +0,114 / t 0,40 / 3/6, CI95 [−0,45; +0,68]; didorong 1 read (+1,36), c2r3 −0,77 | DITOLAK: satu read, order −0,078. |
| P4 | GRAD shrink ke 2,614 (pseudo-count 3; pemisah rezim sebagai prior) | −29,483 (+0,041) | +0,041 / t 0,26 / 5/6, CI95 [−0,27; +0,35]; **order −0,103, t −2,09, 1/6** | DITOLAK: merugikan order secara konsisten; gain size tidak konsisten. |
| P5 | Ensemble OU kappa=0,1 (sim bergantian, mu = mean histori koin; tanpa gate h>1 karena OU≈basis di h kecil) | −29,437 (+0,087) | +0,086 / t 2,16 / 4/6, CI95 [+0,01; +0,16] | KANDIDAT — menunggu cek horizon panjang + uji kombinasi (§4.2.2). |
| P6 | GPD splice ekor size (Hill di-shrink 50% + mean-excess, threshold q90, skala SOL) | −29,463 (+0,061) | +0,061 / t 8,55 / **6/6**, CI95 [+0,05; +0,07]; order persis 0,000 (size-only deterministik) | KANDIDAT — menunggu uji kombinasi + cek horizon panjang (§4.2.2). |
| P7 | Kombinasi: log-pool+OU, GPD+OU, log-pool+GPD, log-pool+GPD+OU | (batch 4) | | Keputusan di §4.2.2. Kombinasi WAJIB diablasi: efek size P1/P6 bisa tumpang tindih dan tidak boleh dijumlahkan begitu saja. |

#### 4.2.1 Mengapa log-pool dipertimbangkan serius (dan apa yang masih harus dibuktikan)

Log-pool adalah satu-satunya varian plus dengan pola yang bersih:
keenam read positif, SD selisih hanya 0,064 (bandingkan SD selisih
inti-vs-v3 = 5,34 — varian ini tidak mengubah satu pun angka order dan
tidak menyentuh RNG, jadi selisihnya adalah efek fungsional
deterministik, bukan noise stream). Mekanisme: pool geometrik
mempertajam densitas size di bin tempat campuran MC dan normal
place setuju, dan menekan bin tempat keduanya tidak setuju — perataan
yang lebih disiplin daripada rata-rata linear saat kedua komponen
membawa informasi yang tumpang tindih. Floor 1e-12 (di bawah floor
scorer 1e-4) mencegah nol logaritmik; renormalisasi menjaga massa.
Risiko yang diakui: +0,14 kecil; seleksi di antara ~10 varian plus
berarti sebagian dari angka ini bisa jadi winner's curse; dan efek di
horizon panjang (tempat blend W→0,30) harus dicek bentuknya sebelum
adopsi. Keputusan akhir di §4.2.2 setelah cek horizon panjang + hasil
batch 3. Bila diadopsi, ia masuk sebagai perubahan ke-4 v4 via edit
tool, dan seluruh verifikasi §5–§7 diulang pada file final.

#### 4.2.2 Keputusan akhir aspek plus

Gate adopsi: mean berpasangan positif + mekanisme masuk akal + bentuk
horizon panjang bersih. Hasilnya adalah pelajaran tentang mengapa gate
ketiga ada:

| varian | splits 40k | horizon panjang (7–13 jam) | putusan |
|---|---|---|---|
| Log-pool (P1) | +0,137, 6/6, t 5,23 | **RUSAK: SD size runtuh ~setengah** (0,68→0,37 dst), bins 82→35, P(≥1e4)=1,00, mean bergeser naik ke 5,02. Di splits W_BAR kecil (≤0,06) sehingga efeknya jinak; di horizon final W_BAR→0,26 dan pool geometrik menghasilkan distribusi sempit yang terlalu percaya diri — hukuman log-score bila realisasi lebih rendah akan brutal. | **DITOLAK** (dan semua kombinasi mengandungnya: triple −29,248 dibuang walau terbaik di splits). |
| GPD splice (P6) | +0,061, 6/6, t 8,55 | **Identik dengan inti** sampai 2 desimal (mean/SD/bins/unnamed sama persis). Tidak ada kerusakan; juga tidak ada perubahan bentuk yang terukur. | **DIADOPSI** (V4-4). |
| OU ensemble (P5) | +0,087, 4/6, t 2,16 | **Bersih dan sesuai teori:** mean turun 0,04–0,06 (reversi bekerja), SD praktis sama, bins 82, unnamed dalam amplop. | **DIADOPSI** (V4-5). |
| GPD+OU (P7) | **−29,383 (+0,141 vs inti)**, 5/6, t 2,98, CI95 [+0,05; +0,23]; vs v3 +4,042 (t 1,88, 5/6) | Bersih: sama dengan OU saja (GPD no-op di 2 desimal). | **KONFIGURASI FINAL v4.** |

Kombinasi yang diadopsi bersifat aditif: +0,141 ≈ +0,061 + 0,087
(selangkah 0,007 dari jumlah bagian — dalam noise). Log-pool + GPD
juga persis aditif (+0,198 = +0,137 + 0,061) dan log-pool + OU
+0,222 ≈ +0,224 — ortogonalitas mekanisme terkonfirmasi, tetapi
ortogonalitas tidak menyelamatkan log-pool dari gate bentuk.

Kejujuran yang wajib dicatat: gain plus total +0,14 nats adalah
Kecil — urutan besarnya sama dengan noise stream (±0,03) × beberapa
kali lipat, dan pola 6/6 pada dua varian size-only sebagian
mencerminkan determinisme fungsional (selisih yang sama di setiap
read karena transformasi yang sama), bukan 6 bukti independen.
Adopsi didasarkan pada: (a) konsistensi arah di semua read, (b)
mekanisme yang prinsipiil dan didukung literatur memo, (c) bentuk
horizon panjang yang bersih, (d) biaya nol (tidak ada konstanta baru
yang rapuh — kappa 0,1 dan shrink 50% adalah prior, bukan hasil
tuning grid). Bila gain ini ternyata noise, kerugiannya terbatas:
tidak ada komponen yang mengubah pagar newcomer, fade, atau order
secara material (Δ order gabungan +0,005).

#### 4.2.3 Kandidat yang TIDAK dibangun (dengan alasan, bukan diam-diam)

- **LHS penggerak berdimensi rendah.** Memo 2 sendiri menyatakan LHS
  naif semua dimensi tidak layak dan desain + ablasi masih diperlukan.
  Model ini tidak punya faktor bersama berdimensi rendah (tidak ada
  common factor; setiap koin punya shock sendiri; jumlah pendatang
  interleaved dengan konsumsi RNG lain), sehingga tidak ada desain
  LHS yang bersih dan jujur dalam waktu yang tersedia. Dicatat
  sebagai sisa riset v5: desain LHS atas draw faktor bersama HANYA
  bila model faktor eksplisit diperkenalkan.
- **PB-DP Poisson-binomial untuk probabilitas place.** Konstruksi DP
  terverifikasi di bawah independensi, tetapi independensi DILANGGAR
  di model ini (tren bersama, fade bersama per read, medan pendatang
  bersama); hibrida faktor belum terverifikasi. Mengganti inti ranking
  MC tanpa ablasi yang menang jelas dilarang oleh brief. Sisa riset
  v5: verifikasi hibrida faktor terlebih dahulu.
- **Bobot likelihood-softmax horizon-gated.** Tidak ada data held-out
  di dalam entry untuk mengestimasi likelihood per komponen tanpa
  pseudo-read internal; membangunnya berarti menambah machinery
  validasi internal yang belum didesain. Log-pool (P1) menguji bagian
  yang dapat diuji dari ide ini.
- **Hazard KM/Weibull sebagai prior lag-fit.** Tidak dibangun dalam
  batas waktu: spell top-5 hanya n=15, left-truncation, dan informasi
  yang sama sudah dipakai bucket lag (fit lagfit ADALAH estimasi
  turnover). Sisa riset v5 dengan desain shrinkage eksplisit.
- **Tempering / extremizing / edge reflection / LCV atas data mentah.**
  Ditolak oleh memo 2 dengan bukti (sinyal tidak robust; refleksi
  −2,09; LCV degenerat karena ties di cap kelahiran). Tidak dibangun.

## 5. Robustness: sweep ±20% (12k sims, kontrol −29,399)

Harness `build/var-sweep2.ts` (toggle env, default = konstanta final
persis; kontrol 12k −29,399 vs 40k −29,383 — selisih 0,016 adalah
noise sim). Setiap konstanta digeser ±20% satu per satu:

| konstanta (nilai final) | −20% (Δ) | +20% (Δ) |
|---|---|---|
| ARRIVAL_CAP (60) | 48: −29,259 (+0,140) | 72: −29,573 (−0,174) |
| span floor (0,25) | 0,20: −29,399 (0,000, inert) | 0,30: −29,469 (−0,070) |
| tail p (0,15) | 0,12: −29,337 (+0,062) | 0,18: −29,450 (−0,051) |
| tail scale (0,25) | 0,20: −29,247 (+0,152) | 0,30: −29,569 (−0,170) |
| blend max (0,30) | 0,24: −29,374 (+0,025) | 0,36: −29,424 (−0,025) |
| blend half (2) | 1,6: −29,425 (−0,026) | 2,4: −29,380 (+0,019) |
| NEWCOMER_CAP (200) | 160: −29,399 (0,000, inert di splits) | 240: −29,399 (0,000, inert di splits) |
| OU kappa (0,1) | 0,08: −29,398 (+0,001) | 0,12: −29,399 (0,000) |
| GPD shrink (0,5) | 0,4: −29,401 (−0,002) | 0,6: −29,396 (+0,003) |
| GPD threshold q (0,90) | 0,85: −29,391 (+0,008) | 0,95: −29,423 (−0,024) |

Rentang keseluruhan [−0,174; +0,152] — TIDAK ADA CLIFF. Dua
pengamatan jujur:

1. **Sumbu sensitif adalah medan newcomer** (arrival cap, tail
   scale): ±0,15–0,17. Konsisten dengan diagnosis: seluruh permainan
   ada di medan newcomer. Dua titik sweep mengalahkan kontrol
   (+0,140 / +0,152) — konstanta TIDAK diubah untuk mengejarnya:
   itu tuning pasca-hoc pada 6 reads yang sama, tepatnya jebakan
   winner's curse yang log ini peringatkan. Nilai final tetap nilai
   prior/v3.
2. **Konstanta baru (kappa, parameter GPD) praktis inert di splits**
   — nilainya adalah prior yang tidak dapat diuji splits (kappa
   bekerja di horizon panjang; GPD hanya menyentuh ekor atas).
   Klaim robustness untuk keduanya terbatas pada "tidak merusak di
   splits + bentuk horizon panjang bersih", bukan "terbukti optimal".

## 6. Verifikasi akhir file final

File final: `main.ts` 765 baris, 37.211 byte, md5
`ff35f4e77e61ff7336db4ccffe46b575`. Diff vs varian harness gpd-ou
HANYA komentar header (30 baris diff, semua komentar).

| cek | hasil |
|---|---|
| Backtest 40k final | **−29,383** (order −18,593 / size −10,790, agree 48); per-cut −32,546 / −26,728 / −25,205. Byte-identik (md5) dengan forecast harness gpd-ou di ketiga cut. |
| Paired vs v3 | +4,042 (SD 5,256, SE 2,146, t 1,88, 5/6, CI95 [−0,16; +8,25]); order +1,341, size +2,701. DM-HLN p = 0,118 (h=1) / 0,160 (h=2) — TIDAK signifikan pada 5%. |
| Paired vs inti | +0,140 (t 2,98, 5/6, CI95 [+0,05; +0,23]). |
| Horizon panjang 7–13 jam (final) | unnamed [0,79 0,81 0,82 0,89 1,00], namedRows [10 10 10 9 0]; size mean 4,88/4,65/4,54/4,44/4,36, SD 0,65/0,62/0,55/0,48/0,44, bins 82, P(≥1e4) 0,83–0,89. Bersih: di dalam amplop L0/L1, mean sedikit di bawah inti (reversi OU), tanpa blow-up. Bandingkan inti: [0,78 0,79 0,79 0,85 0,93], mean 4,92/4,72/4,60/4,48/4,40. |
| Determinisme | Dua run pada input cut-3 byte-identik (md5 sama, `cmp` lolos). |
| Runtime 66-mark sintetis | 16,1 detik, output 17.377 byte — jauh di bawah batas 300 detik / 1 MB. Runtime splits 40k: ~17 detik total (3 cut). |
| Audit grep | Import HANYA `node:fs` + `node:path`; `process.env` HANYA untuk `MAKEFUN_INPUT_DIR`/`MAKEFUN_OUTPUT_DIR`; tidak ada fetch/network, kunci, model call, `Math.random`, atau `Date.now`. RNG = mulberry32 seed tetap + Box-Muller. |
| LICENSE | Byte-identik dengan v3 (md5 `d4e8f5e9…`, diff kosong). |
| Direktori entry | Tepat 3 file: `main.ts`, `LICENSE`, `BUILD_LOG.md`. Scratch/harness di `pumpfun-v4-work/build/`. |

## 7. Sumber GitHub: dipakai, ditolak, lisensi

Riset: `pumpfun-v4-work/github-research/MEMO.md` + `MEMO2.md`.
PENTING: tidak ada satu baris kode pun yang disalin ke dalam entry —
semua adaptasi ditulis ulang dari rumus matematika. Entry tetap
stdlib-only; tidak ada dependensi baru.

**Diadopsi ke dalam `main.ts`:**

| sumber (lisensi) | yang dipakai | bukti |
|---|---|---|
| heavytails (MIT) | Matematika Hill/GPD: estimator Hill atas exceedance, relasi mean-excess σ = E[excess]·(1−γ), survival GPD | MEMO.md: Hill γ tidak stabil 1,43→0,25 menurut k; GPD γ=1,21, σ=108,5; 2,0% held-out di atas max train. Di entry: γ di-shrink 50% ke 0, tidak pernah hard-code 1,21. |
| skaters (MIT) | Ide splice GPD + famili OU (kappa, mean-reversion ke running mean, momen multi-step eksak) | MEMO.md: splice + OU + PIT; port laplace penuh DITOLAK. Di entry: splice pada campuran MC (bukan laplace), OU kappa=0,1 sebagai anggota ensemble 50%. |

**Dipakai offline saja (bukan di entry):**

| sumber (lisensi) | pemakaian |
|---|---|
| dieboldmariano (MIT) | Rumus DM + HLN + LRV Bartlett untuk `build/dm.mjs` (pagar sekunder §3/§6). Cacat kode repo (`fabs(h_prev < small)`) diperbaiki dalam penulisan ulang. |
| mechanisms (MIT) | Ide log opinion pool — DIUJI sebagai P1, DITOLAK oleh gate horizon panjang (§4.2.2). Floor 1e-12 dipakai sesuai peringatan memo. |
| simple-statistics (ISC) | KDE Silverman + kuantil type-7 — DIUJI sebagai P2a/P2b, DITOLAK (−0,094 / −0,048). |
| Quant_Monte_Carlo (MIT) | Ide antithetic — DIUJI sebagai P3a dengan desain mirror yang benar, DITOLAK (efek −0,011). |
| panelary (Apache-2.0) | Clark-West — TIDAK dipakai sebagai gate: powerless di n=6 (t=−0,21 salah arah pada model benar). |
| properscoring (Apache-2.0) | Diagnostik CRPS/Brier — tidak dipakai untuk tuning (dilarang memo). |

**Ditolak / tidak dibangun (dengan alasan di §4.2.3 dan MEMO/MEMO2):**
lifelines (MIT, KM — tidak dibangun, n kecil); poibin (MIT, PB-DP —
hibrida faktor belum terverifikasi); bocd (BSD-3 — posterior ≈ prior
di n=5); QuasiMonteCarlo.jl (MIT, LHS — tidak ada penggerak
berdimensi rendah); kdensity (MIT, partial); PlackettLuce (GPL-3),
ensembleBMA/BMA (GPL), lmoments3 (GPLv3), evd (GPL) — lisensi
copyleft tidak kompatibel; M5-methods (TANPA LISENSI);
pump-fun-sdk (konflik lisensi 3 arah); scoringrules, seedrandom,
lifetimes, SALib, sktime, statsforecast, stdlib-js (tidak cocok /
redundan); tempering/extremizing/refleksi tepi/LCV mentah (bukti
merugikan). Fakta protokol pump.fun (cap kelahiran ≈28 SOL, graduasi
≈411 SOL) dipakai sebagai jangkar/prior SAJA, tidak pernah sebagai
cap keras; lisensi docs pump.fun BELUM terverifikasi.

## 8. Kelemahan tersisa + asumsi belum terjawab

1. **Ekstrapolasi size +1,6 dekade di atas cap maksimum teramati
   (3,56).** Kelemahan struktural terbesar dan jujur. OU menahan
   sebagian (mean turun ~0,05), tetapi tidak menutup jurang. Mitigasi
   size ASIMETRIS (menahan ekstrapolasi ke atas tanpa menahan ke
   bawah) masih pertanyaan terbuka — pelebaran anchor simetris GAGAL
   (arah salah). Jangan klaim v4 "memperbaiki" ini.
2. **Fragilitas poolonly di histori tipis.** Gain cut-2 bersandar
   pada 4 observasi pool; premi overcounting tidak signifikan.
   Fragilitas mengecil di 66-mark (n pool jauh lebih besar), tetapi
   tidak ada jaminan distribusi pool di final sama dengan di
   rehearsal.
3. **Mekanisme order server −0,35 tidak terpecahkan.** Kandidat
   divergensi fit per-place + noise satu-draw (VERIFY.md §5.3).
   Tidak ada perbaikan order yang ditargetkan di v4 selain medan
   yang lebih kuat; bila −0,35 itu nyata dan sistematis, v4
   membawanya juga (fit per-place AKTIF di v4 seperti di v3).
4. **Bias server ~3,9 nats tidak dapat dikoreksi lokal.** Semua
   proyeksi level adalah haircut kasar, bukan estimasi.
5. **Seleksi pada 6 reads berkorelasi (≥116 konfigurasi kumulatif
   + 14 varian plus/kombinasi sesi ini).** Semua CI naif tidak valid
   pasca-seleksi; angka headline mengandung winner's curse.
   Ledger: DIAGNOSIS.md §11 (78 konfigurasi fase v4) + 14 sesi ini.
6. **Transfer sintetis gagal.** Di rezim OU sintetis, keunggulan
   sumber cap tidak mentransfer dan entry kalah dari sebaran merata
   di horizon panjang. Rezim sintetis ≠ rezim final — peringatan,
   bukan vonis — tetapi tidak ada validasi transfer yang lolos.
7. **Asumsi yang belum terjawab:** (a) Apakah laju arrival
   stasioner selama 24 jam final? (b) Apakah distribusi cap pool
   stabil antar-rezim pasar? (c) Apakah fade fit (rank churn)
   berperilaku sama di histori 66-mark? (d) Apakah recorder
   "known-only" di final sama dengan rehearsal? (e) Apakah kappa OU
   0,1 mendekati kecepatan reversi sebenarnya? Tidak satu pun dapat
   dijawab dari data lokal yang ada.
8. **Ide turnamen yang DICATAT SAJA, tidak pernah dibangun/diuji
   (sesuai larangan):** entry high-variance yang sengaja salah
   kalibrasi untuk memaksimalkan peluang menembus cutoff (bukan
   ekspektasi skor). Dicatat di sini sebagai ide yang dipertimbangkan
   dan ditolak oleh brief — bukan sebagai rekomendasi.

## 9. Proyeksi server + penilaian jujur

| skenario | perhitungan | proyeksi |
|---|---|---|
| Lokal final (40k) | terukur | −29,38 |
| Haircut bias saja | −29,38 − 3,9 | ≈ −33,3 |
| Realistis (bias + winner's curse 1–2 nats) | −33,3 − (1 s.d. 2) | **−34,3 s.d. −35,3** |
| Cutoff hadiah (angka lama, papan tak dapat diakses) | — | ≈ −33,7 |

**Penilaian jujur.** v4 final BUKAN "jelas lebih baik" dari v3
secara statistik: selisih berpasangan +4,04 dengan CI95 yang
menyentuh nol ([−0,16; +8,25]) dan DM-HLN p ≈ 0,12–0,16. Yang dapat
dikatakan dengan jujur: (a) tiga perubahan inti masing-masing punya
mekanisme yang benar dan lolos ablasi berpasangan; (b) dua aspek plus
yang diadopsi konsisten arahnya, ortogonal, dan bersih bentuknya;
(c) tidak ada komponen yang diketahui merugikan; (d) ekspektasi
bersih positif dengan biaya 1 kuota submit dari 7 tersisa (3/10
terpakai sebelum v4). Proyeksi realistis berada DI BAWAH cutoff —
v4 adalah perbaikan berbiaya rendah ekspektasi positif + satu
datapoint server OOS yang bersih untuk membedakan hipotesis
(order −0,35 sistematis vs noise), BUKAN permainan hadiah yang
terkunci. Keputusan submit ada di tangan Adhi; v3 tetap entry live
sampai keputusan itu dibuat.

## 10. Handoff v5

1. **Sisa riset MEMO2 §6 (12 item):** hibrida faktor PB-DP; desain
   LHS berdimensi rendah; EVT multivariat; BMA berlisen permissive;
   L-moment dari textbook (bukan lmoments3 GPL); kalibrasi beta OOF;
   kernel gamma Chen; repo BOCD "106-"; lisensi docs pump.fun;
   lisensi repo M5 matthiasanderer; tempering per-place; bentuk w(h).
2. **Mekanisme order −0,35:** bila skor practice v4 keluar, bandingkan
   komponen order v4 vs v3 vs v1. Bila order v4 ≈ v3 < v1, hipotesis
   divergensi fit per-place menguat → v5 harus menyelidiki regularisasi
   fit per-place (shrinkage lebih kuat / prior bersama) TANPA
   menghancurkan pagar newcomer. Bila order v4 ≈ v1, −0,35 kemungkinan
   noise.
3. **Mitigasi size asimetris:** pertanyaan terbuka terbesar (§8.1).
   Kandidat: anchor atas (ceiling lunak pada place-normal di horizon
   panjang), shrinkage mean size ke arah bawah yang diskala horizon,
   atau kalibrasi ekstrapolasi dari kurva cap historis. Setiap
   kandidat wajib lolos gate bentuk horizon panjang — pelajaran
   log-pool (§4.2.2) menunjukkan splits tidak dapat melihat kerusakan
   horizon panjang.
4. **Desain LHS / PB-DP:** hanya setelah model faktor eksplisit ada
   (LHS) / hibrida faktor terverifikasi (PB-DP). Jangan ulangi
   percobaan naif.
5. **Data yang akan mengubah segalanya:** skor practice v4 (satu
   draw OOS bersih) + papan publik yang dapat diakses (cutoff
   sebenarnya + distribusi skor). Tanpa keduanya, v5 tetap menebak
   dalam kegelapan yang sama.
6. **Jangan sentuh:** fade fit/prior, ceiling kurva 2,55, greedy
   naming + rescale v1, lag-fit repair. Empat hal ini load-bearing
   dan sudah terbukti mahal bila diubah.

## 11. Catatan sesi

- `main.ts` ditulis dengan tool tulis (1 write + 3 append) lalu
  SEMUA revisi berikutnya via tool edit dalam sesi ini; tidak ada
  exec/sed/cp yang menyentuh `main.ts`. Diff vs v3 = header +
  5 perubahan kode; diff vs varian harness gpd-ou = header saja.
- Tidak ada submit/sign/repo/push; tidak ada tulis ke `~/.makefun`,
  `~/.baw*`, `pumpfun-repo/`, direktori v1/v2/v3, v3-work, atau
  diag/. Tidak ada instal skill.
- Seluruh angka dalam log ini berasal dari run scorer yang
  dijalankan sesi ini (log mentah di `pumpfun-v4-work/build/`:
  `v4core-40k.log`, `t5harness-40k.log`, `v1/v2/v3-40k.log`,
  `paired-*.log`, `dm-*.log`, `plus-*.log`, `longh-*.log`,
  `v4final-40k.log`, `synth66-v4final.log`) atau dikutip dari
  DIAGNOSIS.md/VERIFY.md/MEMO.md/MEMO2.md dengan atribusi.
- Eksplorasi plus dibekukan 15:48 WIB (sebelum batas 17:45 WIB);
  laporan disusun sebelum deadline 18:00 WIB.
