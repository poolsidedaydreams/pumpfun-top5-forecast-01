# BUILD LOG — entry v5, pumpfun-top5-forecast-01

**Bahasa: Indonesia. Dibangun 12 Nov 2026, 16:36–16:47 WIB, oleh builder v5
(subagent). TIDAK ada submit/sign/buat repo/push; TIDAK ada API key dipakai;
TIDAK ada skill diinstal oleh builder ini. Deadline kompetisi 21:00 WIB.**

## 0. Ringkasan

- **v5 = v3 + 3 patch** (span arrival + cadence, bobot size = u, w(h) ESS).
  **BUKAN dari basis v4.** v4 adalah datapoint negatif server (§1).
- **Skor lokal 40k terukur (cuts 2–4 tertimbang, scorer tervalidasi):
  v5 −32,039** (order −19,655 / size −12,384, agreement 45) vs v3 −33,425
  dan v1 −34,197. Δ vs v3 **+1,386** (+0,279 order / +1,107 size), menang
  6/6 read berpasangan.
- **Peringatan kejujuran atas angka −32,039:** angka lab −33,029 yang dikutip
  sebagai "harapan" adalah skor **combo-se (v3 + sizew + ESS) TANPA span**.
  v5 menambahkan span, yang menyumbang +0,99 di atas combo-se pada build ini
  (standalone +1,223; interaksi −0,23). Dekomposisi aditif dari komponen lab:
  −33,425 + 1,223 + 0,332 + 0,064 = −31,806 vs terukur −32,039 (interaksi
  −0,233). Selisih vs harapan BUKAN kesalahan build — build ini direproduksi
  dan dideterminisme-verifikasi (§5); penyebabnya adalah definisi kombinasi
  yang berbeda. **Dan yang lebih penting: +0,99 dari span adalah artefak
  cut tipis (hanya cut-2) yang bernilai ~0 pada histori final 66-mark.**
  Proyeksi server yang jujur tetap memakai haircut (§7): v5 adalah
  perbaikan, bukan permainan hadiah.
- **Stretch goal: KEDUANYA TIDAK DIADOPSI.** Hibrida PB-DP tidak diprototype
  (pemblokir kalibrasi §8.1). LHS terminal diprototype penuh di scratch dan
  GAGAL lolos gate skor (netral dalam noise, mean −0,006 atas 4 seed; §8.2).
- **File:** `main.ts` (709 baris, 35.118 byte, md5
  `a3460d5f0abf49fa9aa07ce18b585413`), `LICENSE` (byte-identik v4),
  `BUILD_LOG.md` (file ini).

## 1. Diagnosis: v4 adalah datapoint negatif

Skor practice SERVER (terverifikasi koordinator/parent, 7 read, horizon
10–70 menit):

| Entry | Total | Order | Size | Gap lokal-vs-server |
|---|---|---|---|---|
| v1 | −38,029901 | −20,050415 | −17,979485 | −3,83 |
| v3 | −37,314359 | −20,403533 | −16,910826 | −3,89 |
| v4 | −39,554791 | −20,186259 | −19,368532 | −10,17 |

- v4−v3 server: total −2,240; order +0,217; size **−2,458**. Kerusakan di
  **size**. Keuntungan lokal v4 (+4,04 vs v3) TIDAK transfer.
- Submission v4: `01a1cefd-e2bf-77e8-850e-f35bb80ff07c`, finished,
  agreement 53, ranked, prize_eligible.
- **Hipotesis divergensi fit per-place (−0,35 order v3) MELEMAH.** Order
  server v4 (−20,19) berada di antara v1 (−20,05) dan v3 (−20,40), padahal
  v4 membawa fit per-place yang sama dengan v3. −0,35 kemungkinan besar
  noise satu draw practice (7 read berkorelasi). Urgensi shrinkage
  per-place TURUN; eksperimen shrinkage di lab pun inert (§4).
- **Bias lokal ~3,9 nats terlalu optimistis** (v1/v3). Practice = horizon
  10–70 menit; **final = 7–13 jam** — rezim yang berbeda, dan semua gate
  horizon panjang dalam log ini ada karena perbedaan itu.
- Cutoff hadiah papan publik ≈ −33,7 (angka koordinator; builder tidak
  memverifikasi papan secara independen). Jarak v3 ke cutoff ≈ 3,6 nats.

## 2. Validasi scorer + reproduksi baseline

- Harness disalin dari `~/workspace/makefun/pumpfun-v3-work/` ke scratch
  `~/workspace/makefun/pumpfun-v5-work/build/` dan md5-nya DIVERIFIKASI
  SEBELUM dipakai: `scorer.mjs 45e9e362e92a5ff927d2c3df65b73100`,
  `backtest.mjs f872bb2a9a6d357a7fa596675adc070f` — keduanya cocok.
- Reproduksi v3 (40k, cuts 2–4 tertimbang): **−33,425** (order −19,934 /
  size −13,491, agree 45); per-cut −40,595 / −26,492 / −25,783 — **cocok
  persis** dengan BUILD_LOG v3 dan laporan lab. Reproduksi v4 oleh lab:
  −29,383, cocok persis BUILD_LOG v4.
- Verifikasi dijalankan dengan Node v24.22.1 (satu-satunya Node di VM ini).
  Entry menarget Node 22, stdlib-only, tanpa fitur khusus Node 24
  (type-stripping + `node:fs`/`node:path` saja); tidak ada network, kunci,
  atau model call. Runtime dan determinisme diukur pada Node tersebut (§5).

## 3. Tiga patch v5 (jangkar pada main.ts v3, 659 baris, READ-ONLY)

Seluruh kode selain patch di bawah + komentar penjelas adalah v3 verbatim
(diverifikasi dengan `diff` terhadap v3: tidak ada perbedaan lain).

### P1 — Span arrival + cadence (bug fix)

- Jangkar v3: baris `spanH = recent.length > 1 ? ... : 1;` di blok
  arrival-rate.
- Pengganti: blok cadence (median gap antar-mark; span = gap
  pertama-terakhir + cadence; satu mark → span = cadence). Floor 0,25 jam
  dan cap 60/jam tidak berubah.
- Bukti lab (iso-span): +1,223 lokal, HANYA cut-2 (+2,30/+2,57/+2,47);
  cut-3/4 persis 0,00 (cap ARRIVAL 60 mengikat). **Jangan klaim +1,22
  untuk final — efeknya ~0 pada histori 66-mark.** Diadopsi sebagai
  perbaikan kebenaran (span pertama-terakhir saja mengecilkan jendela
  penghitungan entrants), bukan sebagai sumber gain.

### P2 — Bobot size = u

- Jangkar v3: blok `const probs = ...` di loop emit sizes. Ditambah
  `const uW = uPlace[k - 1]!;` sebelum loop; `const mix =
  (1 - simNew) * pk + simNew * pnw;` menjadi
  `const mix = (1 - uW) * pk + uW * pnw;`.
- Bukti lab (iso-sizew): +0,332 (size), 5/6 read; gate horizon panjang:
  mean TURUN p1 5,14→4,73 (−0,41), p2 −0,21; SD p1 0,84→0,65; unnamed
  identik — arah anti-ekstrapolasi.

### P3 — w(h) ESS (satu-satunya adopsi baru di luar v3)

- Jangkar v3: baris `const blendW = (h: number): number =>
  SIZE_BLEND_MAX * h / (h + SIZE_BLEND_HALF_H);`.
- Pengganti (bandwidth 0,5 jam; `SIZE_BLEND_MAX = 0,3` tidak berubah;
  `SIZE_BLEND_HALF_H` dipertahankan tetapi tidak terpakai):
  `ESS_TOT` = jumlah kernel Gaussian atas lagPts place≥1 di lag 0;
  `blendW(h) = SIZE_BLEND_MAX * clamp(1 - ESS(h)/ESS_TOT, 0, 1)`.
- Bukti lab: menang di KEDUA basis (v3 +0,064; v4 +0,070), gate bersih,
  transfer sintetis +0,84/+0,88. Sensitivitas bandwidth 1,0 jam (+0,109 di
  basis v4) TIDAK diadopsi — dipilih setelah melihat skor; bw 0,5 adalah
  desain yang dikomitmenkan sebelumnya.
- Bentuk w(h): W_BAR splits kini 0,042/0,033/0,023 vs ESS 0,028/0,000/0,000
  (cut 2/3/4); horizon 7–13 jam: kini 0,249 vs ESS 0,300. ESS ≈ blend-OFF
  di splits dan bobot anchor PENUH di horizon panjang pada histori tipis;
  pada histori akhir 66-mark, lag ada sampai 13 jam sehingga w_ESS(h) di
  horizon panjang < 0,30 secara adaptif.

### Perbaikan kosmetik: duplikasi `nonEmpty`

- Kedua blok v3 (arrival-rate dan trend) menghitung daftar mark non-kosong
  yang identik secara independen. v5 menghitungnya sekali
  (`nonEmptyMarks`, sebelum blok arrival) dan memakainya di kedua blok.
- **Bukti perilaku-identik:** backtest 40k penuh sebelum/sesudah perbaikan
  menghasilkan forecast byte-identik di semua cut (md5 cut-2
  `414e10c354d88ebe327ed84d58261658`, cut-3
  `68841964b34cb5e3eea99c9a50458ff4`, cut-4
  `4b55698e99f51fd738ba888b0957de96`) dan skor identik −32,039.
  Perbaikan dipertahankan.

## 4. Ablasi lab (disalin dari LAPORAN LAB ABLASI v5)

Sumber: `~/workspace/makefun/pumpfun-v5-work/ablate/LAB-REPORT.md`
(dibekukan 16:35 WIB 12 Nov 2026). Semua skor 40k, cuts 2–4 tertimbang,
berpasangan, kecuali dinyatakan lain. Builder TIDAK mengulang lab ini;
tabel di bawah adalah salinan + putusan lab, dan §5 adalah verifikasi
independen builder atas kombinasi final saja.

### 4.1 Batch 1+2 — varian dari main.ts v4 (vs v4 −29,383)

| Varian | Skor | Δ total (order/size) | Putusan |
|---|---|---|---|
| shrink60 (prior 30→60) | −29,387 | −0,004 | TIDAK DIADOPSI (inert) |
| shrink120 (prior 30→120) | −29,389 | −0,006 | TIDAK DIADOPSI (inert) |
| shrinkparam (fInf/tau 50% ke pooled) | −29,387 | −0,004 | TIDAK DIADOPSI (inert) |
| anchdown03 (mean −0,30·h/(h+2)) | −29,387 | −0,004 | DITOLAK |
| anchdown06 (mean −0,60·h/(h+2)) | −29,391 | −0,008 | DITOLAK |
| gpdexp (gamma GPD 0,5→0) | −29,392 | −0,009 | DITOLAK |
| ceilhist (ceiling HIST_MAX+0,8, decay 2) | −29,353 | +0,030 | DITOLAK (gain rapuh + gradien longh runtuh 0,52→0,14) |
| ceilsoft (ceiling +1,2, decay 1) | −29,380 | +0,003 | DITOLAK (gain menguap bila dilunakkan) |
| **esswh (w(h) ESS, bw 0,5h)** | **−29,313** | **+0,070** | **ADOPSI (P3)** |
| essbw10 (w(h) ESS, bw 1,0h) | −29,275 | +0,109 | SENSITIVITAS, bukan adopsi |
| pstart (parametric-start KDE) | −29,367 | +0,016 | DITOLAK (tak konsisten, 4/6) |
| chen40 (kernel gamma Chen h=40) | −29,494 | −0,111 | DITOLAK (rapuh, SD antar-read 1,50) |
| temper115 (α ≈1,15) | −29,194 | +0,189 | **DITOLAK** (transfer sintetis −0,70/−0,59) |
| bocdprior (bobot tren hazard 1/5) | −29,383 | 0,000 persis | TIDAK DIADOPSI (inert; cap tren mengikat) |

### 4.2 Isolasi 5 perubahan v4 (aditif dari v3 −33,425)

| Varian | Skor | Δ (order/size) | Putusan |
|---|---|---|---|
| **iso-cap** (cap newcomer pool-only) | −30,629 | **+2,796 (+0,791/+2,005)** | **TERSANGKA UTAMA — DITOLAK** |
| iso-gpd (GPD splice Hill) | −33,550 | −0,125 | DITOLAK |
| iso-ou (OU κ=0,1) | −33,592 | −0,167 (+0,205/−0,372) | DITOLAK (net negatif) |
| iso-span (+cadence) | −32,202 | +1,223 (+0,280/+0,943) | **KEEP (P1, bug fix)** |
| iso-sizew (bobot=u) | −33,093 | +0,332 (size) | **KEEP (P2)** |
| v4minus-cap (subtraktif) | −32,305 | −2,922 vs v4 | Konfirmasi cap = penyumbang keunggulan lokal v4 |

Dekomposisi aditif: +2,796 +1,223 +0,332 −0,125 −0,167 = +4,059 ≈
v4−v3 +4,042 (interaksi ≈ −0,017). Mekanisme kerusakan cap: gain lokal
bertumpu pada 4 observasi pool di cut-2 (per-read +4,85/+5,90/+6,44 dan
−4,12; SD antar-read 4,04); di horizon panjang ia menurunkan pagar
unnamed (1,00→0,93) dan menamai 6 koin di h=13 jam vs 0 pada v3. Pada
7 read practice segar, taruhan itu berbalik: size −2,46 vs v3.

### 4.3 Diagnostik offline (tidak mengubah entry)

- **Tempering size:** grid global α naik sampai tepi grid 1,30 (+0,301
  in-sample); LODO-by-cut +0,160. Sinyal splits NYATA tapi HANYA rezim
  horizon-pendek. Transfer sintetis rezim horizon-panjang: −0,704 (R1) /
  −0,585 (R3). DITOLAK: sharpening buta-horizon; α tak teridentifikasi
  (tepi grid); arsitektur satu-distribusi-size-untuk-semua-read tidak
  memungkinkan tempering ber-gate horizon.
- **Kalibrasi beta OOF:** 3.015 pasangan (30 positif). Fit IRLS + ridge:
  lam=10 → (a,b,c)=(1,076; 1,041; 0,232); LODO ΔLL campuran
  (+0,0001/−0,0003/−0,0005); end-to-end in-sample +0,018. Desain layak
  sebagai diagnostik, bukti OOF ≈ nol — TIDAK DIBANGUN sebagai perubahan
  entry (hanya 30 positif; pasangan dalam satu read-place dependen;
  massa unnamed tidak terkalibrasi; kalibrasi OOF sejati butuh engine
  pseudo-read bersarang).
- **LCV kernel gamma Chen:** peakCaps pool-only n=36. Optimum interior
  h=40 SOL (LCV −7,99/−8,01). Tidak degenerat — tetapi Chen tetap DITOLAK
  di entry (iso chen40 −0,111, rapuh).
- **BOCD prior-only:** Δ 0,000 persis — cap tren mengikat. BOCD penuh
  (≈ prior pada n=5–6) tidak akan berbeda. TIDAK DIADOPSI.
- **GPD shape L-moment:** iso-gpd-lm −33,445 (−0,020 vs v3) — lebih baik
  dari Hill (+0,105) tapi tetap negatif. Splice GPD DITOLAK dalam kedua
  estimator.

### 4.4 ESS di basis v3 + kombinasi (basis v5)

| Varian (basis v3) | Skor | Δ vs v3 | Transfer sintetis (12k) |
|---|---|---|---|
| iso-ess (v3+ESS bw 0,5) | −33,362 | +0,064 (size) | — |
| **combo-se (v3+sizew+ESS)** | **−33,029** | **+0,397 (size)** | **R1 +1,948; R3 +1,012 vs v3** |

Kombinasi aditif sempurna (+0,332 + 0,064 = +0,396 ≈ +0,397). ESS menang
di KEDUA basis — robust terhadap basis. Transfer sintetis besar di kedua
rezim (semua size). **Catatan definisi (penting, lihat §0): combo-se
TIDAK mengandung span.** v5 = combo-se + span; skor v5 terukur −32,039.

## 5. Verifikasi builder atas v5 final

### 5.1 Skor 40k terukur (backtest.mjs, cuts 2–4)

| Cut | v5 | v3 | Δ |
|---|---|---|---|
| cut 2 (3 marks → 3 reads) | −38,038 (order −23,542 / size −14,496, agree 7) | −40,595 | +2,557 |
| cut 3 (4 marks → 2 reads) | −26,262 (order −16,587 / size −9,675, agree 21) | −26,492 | +0,230 |
| cut 4 (5 marks → 1 read) | −25,595 (order −14,128 / size −11,467, agree 17) | −25,783 | +0,188 |
| **Tertimbang cuts 2–4** | **−32,039 (order −19,655 / size −12,384, agree 45)** | **−33,425** | **+1,386** |

Per-read berpasangan vs v3 (6 read): cut2r1 +2,543; cut2r2 +2,757;
cut2r3 +2,372; cut3r1 +0,149; cut3r2 +0,311; cut4r1 +0,188.
dLog mean +1,387, SD 1,289, SE 0,526, t 2,63, CI95 naif [0,034; 2,740],
menang 6/6. dOrder mean +0,280 (3/6 — hanya cut-2, efek span), dSize mean
+1,107 (6/6). Agreement identik (selisih 0). **CI naif TIDAK valid
pasca-seleksi** (§9) — dilaporkan sebagai statistik deskriptif saja, bukan
bukti signifikansi.

### 5.2 Determinisme, runtime, ukuran output

- 2 run backtest penuh byte-identik di semua cut (md5 §3, perbaikan
  `nonEmpty`). Run ketiga (setelah perbaikan `nonEmpty`) juga identik.
- Runtime per cut: 2,5–8,5 detik (40k sims, ≤3 read). Cek horizon panjang
  (7 read, 7–13 jam): 32,7 detik. Semua jauh di bawah batas 300 detik.
- Ukuran output: 8.754–11.256 byte (backtest), 16.873 byte (horizon
  panjang) — jauh di bawah 1 MB.
- Node 22 (target), stdlib only (`node:fs`, `node:path`), tanpa network /
  kunci / model call. Verifikasi dijalankan di Node v24.22.1 (§2).

### 5.3 Gate horizon panjang (longh.mjs, histori penuh, reads 7–13 jam)

| | v5 | v3 |
|---|---|---|
| unnamed (p1–p5) | [0,79 0,82 0,84 0,95 1,00] | identik |
| namedRows | [10 10 10 5 0] | identik |
| size mean (p1–p5) | 4,68 / 4,47 / 4,36 / 4,26 / 4,19 | 5,14 / 4,73 / 4,48 / 4,32 / 4,23 |
| size SD (p1–p5) | 0,66 / 0,63 / 0,54 / 0,45 / 0,41 | 0,84 / 0,75 / 0,58 / 0,46 / 0,39 |
| bins | 82 semua place | 82 semua place |

**Gate BERSIH:** pagar unnamed utuh dan identik dengan v3; mean turun ke
arah realisasi (~3,2–3,6); gradien antar-place terjaga (4,68→4,19);
SD tidak runtuh; top5 sama dengan v3. Bentuknya identik dengan longh
combo-se lab — span tidak mengubah bentuk horizon panjang pada histori
ini (cap ARRIVAL mengikat). Catatan jujur: mean size v5 (~4,2–4,7) MASIH
jauh di atas realisasi (~3,2–3,6) — ekstrapolasi belum sembuh (§10).

### 5.4 Audit grep + LICENSE

- `main.ts`: tidak ada `fetch`/http/net/WebSocket/child_process; tidak ada
  kata kunci API key/secret/password/private key/bearer/token; tidak ada
  `Math.random`/`Date.now`; tidak ada penyebutan GPL/LGPL/AGPL. Import
  hanya `node:fs` dan `node:path`.
- `LICENSE` disalin dari LICENSE v4 dan diverifikasi byte-identik
  (`cmp` lolos, 1.104 byte).

## 6. Sumber GitHub + lisensi

Riset: MEMO2 (`pumpfun-v4-work/github-research/MEMO2.md`) dan MEMO3
(`pumpfun-v5-work/research/MEMO3.md`). **Tidak ada kode repo yang disalin
ke entry ini** — semua adaptasi berasal dari rumus/textbook dengan
atribusi; patch v5 sendiri (span, bobot-u, ESS) adalah konstruksi lab
dari data, bukan adaptasi kode repo.

Lisensi TERVERIFIKASI (file LICENSE/DESCRIPTION dibaca langsung oleh
worker riset): poibin MIT (© Mika J. Straka), QuasiMonteCarlo.jl MIT
(© Chris Rackauckas), heavytails MIT, skaters MIT, bocd BSD-3-Clause
(Gregory Gundersen), kdensity MIT (© Jonas Moss), dieboldmariano MIT,
mechanisms MIT, simple-statistics ISC, panelary Apache-2.0,
properscoring Apache-2.0, matthiasanderer/m5-accuracy-competition
Apache-2.0 (MEMO3 §8.2; kode tak terpakai), y-bar/bocd MIT (redundan).
Rumus paper (bukan kode): Hosking & Wallis (1997) L-moment/PWM; Chen
(2000) kernel gamma; Hjort & Glad parametric-start; Coles, Heffernan &
Tawn (1999) chi/chi-bar; Kull, Silva-Filho & Flach (2017) kalibrasi beta;
Adams & MacKay (2007) BOCD; Silverman (1986) LCV.

DILARANG / DITOLAK sebagai kode (tetap berlaku): lmoments3 GPLv3,
`mev` GPL-3, BOCD.jl LGPLv3, PlackettLuce/BMA/ensembleBMA/evd GPL, repo
BOCD "106-" tanpa lisensi, M5-methods tanpa lisensi, pump-fun-sdk konflik
lisensi (LICENSE proprietary vs package.json Apache-2.0 vs klaim MIT),
pump-public-docs tanpa lisensi (fakta/parameter saja: cap lahir ≈28 SOL,
graduasi ≈411 SOL — terkonfirmasi independen oleh data kit; peringatan
drift parameter rezim V2/V3, MEMO3 §8.1), `ocp` GPL-3 (bukti pencarian),
`extremeloss`/`scikit-extremes`/Kats `bocpd`/`multivariate-bocd` (lisensi
hanya bukti pencarian — jangan adaptasi sebelum file LICENSE dibaca),
`xtremes`/`ExtremeLy` (lisensi tidak ditemukan).

## 7. Proyeksi server (dengan haircut — jujur)

- Titik awal: v3 practice server −37,31.
- Gain lokal v5 vs v3 (+1,386) TIDAK boleh dibawa penuh ke server:
  (a) +0,99 di antaranya adalah span, artefak cut tipis bernilai ~0 di
  final; (b) bias lokal ~3,9 nats; (c) ≥154 konfigurasi diseleksi pada
  6 read yang sama — haircut winner's curse 1–2 nats (§9).
- Sisa yang bisa dipertahankan secara prinsip: sebagian kecil dari +0,40
  combo-se (ESS + sizew), yang menang di dua basis + transfer sintetis
  positif + gate bersih. Proyeksi yang jujur: v5 sedikit lebih baik dari
  v3 di server, **tetap di bawah cutoff ~−33,7**.
- **v5 adalah perbaikan, bukan permainan hadiah.** Tidak ada klaim bahwa
  v5 menutup jurang hadiah ~3,6 nats. Keputusan submit ada di tangan Adhi;
  v3 tetap entry live terbaik yang terverifikasi server sampai skor
  practice v5 (bila disubmit) keluar.

## 8. Stretch goal — keputusan dan bukti

Beku pada 17:30 WIB sesuai perintah. Kedua item diputuskan SEBELUM beku;
tidak ada perubahan main.ts dari stretch goal.

### 8.1 (a) Hibrida PB-DP + faktor bersama (MEMO3 §1) — TIDAK DIPROTOTYPE

Konstruksi terverifikasi MEMO3 vs MC penuh pada sintetis berkorelasi
(selisih maks 0,0013; PB naif bias 0,20) — tetapi TIGA pemblokir §1.5
belum terverifikasi: (1) kalibrasi faktor dari data nyata (loading b_i,
skala F_m/F_s/F_n dari kovarians residual cross-sectional dengan
shrinkage kuat; 6 mark terlalu tipis; estimasi loading per koin TIDAK
direkomendasikan); (2) distribusi kondisional Normal X_i|F vs path entry
penuh (non-Gaussian: saturasi momentum, hazard fade, lompatan graduasi,
ceiling kurva) belum diablasi; (3) kuadratur 3-faktor belum teruji dan
runtime (~184 juta operasi DP) belum diukur. Membangun hibrida dengan
faktor ber-prior mentah dalam jendela beku akan menghasilkan varian yang
tidak memenuhi gate adopsi (menang 40k + gate longh + transfer sintetis
+ determinisme) secara kredibel. **Keputusan: tidak diprototype; didokumentasikan
sebagai handoff prioritas tertinggi (§10).** Ini keputusan atas dasar
bukti-ketiadaan-kalibrasi, bukan atas dasar kemalasan: builder menilai
risiko memasukkan inti ranking yang tidak terkalibrasi 3,5 jam sebelum
deadline lebih besar daripada upside yang belum terukur.

### 8.2 (b) LHS atas shock terminal (MEMO3 §2) — DIPROTOTYPE, TIDAK DIADOPSI

Prototipe penuh di scratch (`pumpfun-v5-work/build/lhs/main-lhs.ts`,
tidak menyentuh entry): stratifikasi LHS titik-tengah + permutasi seeded
per (read, koin) atas uniform radius Box–Muller
`z = sqrt(−2 ln u1)·cos(2πu2)`, u1 terstratifikasi, u2 crude; marginal
eksak Normal baku; cabang fade/graduasi tetap pada stream global.
Desain mengikuti MEMO3 §2.2 (stratifikasi harus mengenai dimensi pembawa
varians — shock idiosinkratik terminal; LHS atas faktor saja plafonnya
~1,03× karena faktor hanya menjelaskan 2,5–2,9% varians).

Hasil gate:

| Cek | Hasil |
|---|---|
| Backtest 40k (seed dasar) | LHS −32,068 vs v5 −32,039 → **Δ −0,029** (dalam noise MC ~0,02–0,03) |
| Seed sweep (4 seed, cuts 2–4) | v5 mean −32,053 (SD 0,012); LHS mean −32,058 (SD 0,007); Δ per-seed: −0,029/+0,005/−0,006/+0,008; mean Δ **−0,006**, tanda campur 2/2 |
| Determinisme | 2 run byte-identik (semua cut) — UTUH |
| Gate horizon panjang | Bentuk IDENTIK dengan v5 (unnamed, mean, SD, bins sama); runtime 35,8 dtk vs 32,7 dtk — BERSIH |
| Varians antar-seed | Rasio SD 1,7× pada n=4 seed — TIDAK signifikan, bukan reduksi varians terverifikasi |

**Keputusan: TIDAK DIADOPSI.** Gate "terverifikasi netral-atau-lebih-baik"
tidak lolos jelas: mean antar-seed (trivial) negatif, tidak ada bukti
gain positif, dan klaim reduksi varians tidak terverifikasi pada n=4.
Menambah ~40 baris + matriks rank (Uint32, ~18 MB per read pada skala
final) demi gain terukur ~0,00 adalah kompleksitas tanpa bayaran.
Prototipe disimpan di scratch untuk pekerjaan lanjutan; MEMO3 sendiri
membingkai LHS-terminal sebagai "asuransi murah" orde 0,01 nats, dan
pengukuran ini konsisten dengan ~0 pada mesin ini. Varian jalur (b)
MEMO3 §2.2 (restrukturisasi terminal) tidak dicoba — ia mengubah mesin
dan hanya masuk akal bersama hibrida §1.

## 9. Ledger seleksi (kejujuran statistik)

- Lab v5: 24 konfigurasi entry pada 6 read yang sama + diagnostik offline
  (grid tempering ~11 α + koordinat per-place + LODO; beta 4 λ + LODO;
  LCV 8 h; bentuk ESS 2 bandwidth).
- Kumulatif: ≥130 (v1–v4) + 24 = **≥154 konfigurasi pada 6 read yang
  sama. CI naif TIDAK valid pasca-seleksi.** Semua Δ positif harus dibaca
  dengan haircut winner's curse 1–2 nats pada level konfigurasi; yang
  bertahan dari haircut adalah ARAH (ESS menang di 2 basis + transfer;
  combo aditif + transfer; pagar unnamed utuh), bukan besaran +0,397
  apalagi +1,386 (yang sebagian besar artefak span).
- Builder ini menambahkan: 1 konfigurasi entry final (v5) + 1 prototipe
  LHS (+ 6 varian seed untuk sweep, yang mengukur noise MC, bukan
  menyeleksi). Tidak ada konfigurasi tambahan yang diseleksi berdasarkan
  skor oleh builder.

## 10. Kelemahan tersisa + handoff

1. **Ekstrapolasi size belum sembuh.** Mean size horizon panjang v5
   (~4,2–4,7) masih ~1 dekade di atas realisasi (~3,2–3,6). Pelebaran
   simetris GAGAL di masa lalu (−1,8). Pertanyaan terbuka terbesar:
   mitigasi size asimetris (ceiling lunak place-normal di horizon
   panjang; shrinkage mean size ke bawah yang diskala horizon; kalibrasi
   ekstrapolasi dari kurva cap historis) — setiap kandidat WAJIB lolos
   gate bentuk horizon panjang.
2. **Hibrida PB-DP + faktor bersama (MEMO3 §1):** upside terbesar, biaya
   terbesar. Handoff: kalibrasi faktor dari data nyata (§8.1) + ablasi
   aproksimasi Normal kondisional + verifikasi densitas size hibrida vs
   MC penuh + ukur runtime pada input 66-mark. Jangan sentuh greedy
   naming / u / fade fit bersamaan dalam satu ablasi.
3. **LHS terminal:** prototipe scratch tersedia (§8.2); pekerjaan lanjutan
   yang sah: sweep seed lebih besar (≥16 seed) untuk menguji reduksi
   varians secara bermakna, atau jalur (b) bersama hibrida. LHS atas
   faktor saja TIDAK BERGUNA; permutasi kongruensial O(1)-memori BELUM
   TERVERIFIKASI (artefak lattice) — jangan dipakai tanpa verifikasi toy.
4. **BMA softmax tempered (MEMO3 §4):** +0,0015, win 70% di toy
   (eta=0,2, di-fix sebagai prior, JANGAN di-grid); butuh verifikasi pada
   pseudo-read. Stacking DITOLAK pada n=6 (−0,069). Default tetap
   equal-weight.
5. **Chen + parametric-start per-place (MEMO3 §6):** desain per-place +
   pemilihan h belum diablasi pada pseudo-read (yang teruji: pstart
   pooled-inkonsisten, Chen rapuh). Bandwidth pooled, lantai h ≥ 0,5
   lebar bin; LCV mentah degenerat (ties) — pakai held-out log-score
   atas sampel MC.
6. **Kalibrasi beta OOF, engine bersarang (MEMO3 §9):** butuh engine
   pseudo-read bersarang untuk OOF yang jujur (leave-one-cut-out);
   bukti OOF saat ini ≈ nol; prioritas rendah. Tanda bahaya: (a,b,c)
   liar antar-fold; gain OOF < 0,05; sharpening pada data yang sudah
   overconfident.
7. **Subtraktif pelengkap (murah, belum dikerjakan):** v4-minus-GPD dan
   v4-minus-OU untuk melengkapi v4-minus-cap; ekspektasi: tidak mengubah
   putusan (interaksi lokal ≈ 0).
8. **EVT multivariat: TERTUTUP.** `mev` GPL-3; tidak ada paket multivariat
   permisif; chi/chi-bar tidak informatif pada n=5–6 (rank maks 6/7 <
   0,9 → joint exceedance selalu 0). Dependensi harus datang dari faktor
   bersama (§1), bukan diagnostik ekor.
9. **Tempering ber-gate horizon:** tidak dapat diuji karena arsitektur
   mengeluarkan SATU distribusi size untuk semua read — perlu kepastian
   apakah skema forecast.json mendukung size per-read.
10. **Parameter kurva rezim V2/V3** (depth-2 quote coin, MEMO3 L12):
    belum diverifikasi dari docs terbaru; anchor 28/411 SOL adalah prior
    yang bisa usang, bukan konstanta protokol.
11. **Hazard diskrit / KM-Weibull sebagai prior lag-fit** (handoff v4,
    MEMO3 L7): desain shrinkage belum dibuat (spell top-5 n=15,
    left-truncation).

## 11. Keadaan pustaka skill saat build

- Diamati pada **16:40 WIB** dan **16:45 WIB**: **2.854** direktori di
  `~/workspace/custom-skills/` (dihitung langsung dengan `ls | wc -l`).
- Putaran instalasi ke-2 koordinator v5 mungkin masih berjalan saat
  pengamatan; angka ini adalah **pengamatan sesaat, BUKAN angka final
  pustaka**, dan builder tidak menginstal/menghapus skill apa pun.
  Builder tidak memakai skill dari pustaka untuk build ini (basis v3 +
  patch lab + rumus MEMO3).

## 12. File + log mentah

- Entry: `~/workspace/makefun/pumpfun-entry-v5/main.ts`,
  `LICENSE`, `BUILD_LOG.md` (file ini).
- Scratch builder (satu-satunya direktori tulis selain entry):
  `~/workspace/makefun/pumpfun-v5-work/build/` — `scorer.mjs`,
  `backtest.mjs` (md5 terverifikasi §2), `paired.mjs`,
  `longh.mjs` (salinan dari lab, baca-saja terhadap lab),
  `bt-v5-r1.log`, `bt-v5-r2.log`, `bt-v3-r1.log`, `bt-v5-dedup.log`,
  `paired-v5-v3.log`, `longh-v5.log`, `longh-v3.log`,
  `lhs/` (prototipe + varian seed + `lhs-seedsweep.log`,
  `lhs-bt-r1.log`, `lhs-bt-r2.log`, `longh-lhs.log`).
- Forecast tersimpan: `/tmp/bt-{v5-r1,v5-r2,v3-r1,v5-dedup,lhs-r1,lhs-r2,
  sweep-*} -cut{2,3,4}/out/forecast.json`, `/tmp/longh-{v5,v3,lhs}/`.
- Yang TIDAK disentuh: `~/.makefun`, `~/.baw*`,
  `~/workspace/makefun/pumpfun-repo/`, direktori v1/v2/v3/v4 dan
  v3-work/v4-work (baca saja; harness disalin ke scratch),
  `~/workspace/makefun/pumpfun-v5-work/ablate/` (baca saja).
- **Pernyataan jujur builder:** tidak ada angka dalam log ini yang berasal
  dari run yang gagal/dipertanyakan; semua angka builder berasal dari
  log mentah di atas; angka lab/server dikutip dengan sumbernya dan
  ditandai sebagai kutipan, bukan pengukuran builder.
