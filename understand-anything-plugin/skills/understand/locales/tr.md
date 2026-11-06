# Türkçe Çıktı Rehberi (Turkish)

Bu dosya, bilgi grafiği içeriği Türkçe üretilirken uyulacak dile özgü kuralları içerir.

## Etiket Kuralları

Etiketleri **İngilizce**, küçük harfli ve tire ile ayrılmış (kebab-case) yazın. Türk yazılım ekipleri bu terimleri günlük dilde İngilizce kullanır; ayrıca `ı`, `ş`, `ğ`, `İ` gibi karakterler arama ve filtrelemede büyük/küçük harf sorunlarına yol açabilir.

| Desen | Önerilen Etiketler |
|-------|--------------------|
| Giriş noktası dosyası | `entry-point`, `barrel`, `exports` |
| Yardımcı fonksiyonlar | `utility`, `helpers`, `common` |
| API handler'ları | `api-handler`, `controller`, `endpoint` |
| Veri modelleri | `data-model`, `entity`, `schema` |
| Test dosyaları | `test`, `spec`, `unit-test` |
| Yapılandırma | `configuration`, `build-system`, `settings` |
| Altyapı | `infrastructure`, `deployment`, `containerization` |
| Dokümantasyon | `documentation`, `guide`, `reference` |

**Kural:** Etiketler her zaman İngilizce kalır; Türkçe yalnızca özetlerde, açıklamalarda, başlıklarda ve turlarda kullanılır.

## Özet Üslubu

Özetleri Türkçe, 1-2 cümle olarak yazın:
- Dosyanın **amacını** ve projedeki **rolünü** anlatın
- Etken çatı kullanın ve cümleyi yüklemle bitirin ("…sağlar.", "…yönetir.", "…işler.")
- Dosya adını tekrar etmeyin
- Doğal, akıcı Türkçe kullanın; İngilizce cümle yapısını kelime kelime çevirmeyin

**Örnekler:**
- İyi: "API katmanında kullanılan tarih biçimlendirme ve string temizleme yardımcılarını sağlar."
- İyi: "Gelen HTTP isteklerinde JWT token'ını doğrulayan middleware'i tanımlar."
- Kötü: "utils dosyası yardımcı fonksiyonlar içerir."
- Kötü: "Sağlar tarih biçimlendirme yardımcıları." (İngilizce söz dizimi)

## Teknik Terimler

Yazılım terminolojisini **İngilizce** bırakın, çevirmeyin:
- `class`, `interface`, `controller`, `service`, `repository`, `model`, `view`, `component`
- `middleware`, `hook`, `barrel`, `entry-point`, `endpoint`, `handler`
- `ORM`, `REST API`, `CI/CD`, `CRUD`, `JWT`, `token`
- `singleton`, `factory`, `observer`, `dependency injection`
- `interceptor`, `guard`, `router`, `state`, `cache`, `queue`

Türkçede yerleşik karşılığı olan genel kavramları ise Türkçe yazın: "istek" (request), "yanıt" (response), "veritabanı" (database), "yapılandırma" (configuration), "doğrulama" (validation), "kimlik doğrulama" (authentication), "bağımlılık" (dependency), "fonksiyon" (function), "kalıtım" (inheritance), "dosya" (file), "karşılama ekranı" (welcome screen), "ana sayfa" (home view).

### Ek getirme (kesme işareti)

İngilizce bir terime Türkçe ek gelirken kesme işareti kullanın ve eki terimin **okunuşuna** göre uyumlu seçin:
- `middleware'i`, `hook'lar`, `controller'a`, `endpoint'ler`, `cache'ten`, `service'i`, `token'ını`
- Kod tanımlayıcılarına (class, fonksiyon, dosya adı) da aynı kural uygulanır: `` `UserService`'i ``, `` `AuthController`'dan ``

## Katman Adları

Katman adlarında teknik kısaltmaları/terimleri İngilizce, "katman" kelimesini Türkçe yazın:
- `API Katmanı`, `Servis Katmanı`, `Veri Katmanı`, `UI Katmanı`
- `Altyapı`, `Yapılandırma`, `Dokümantasyon`
- `Yardımcı Katman`, `Middleware Katmanı`, `Test Katmanı`

## Turlar ve Dil Dersleri

- Tur adımlarının başlık ve açıklamalarını, projeyi ilk kez gören bir geliştiriciye anlatır gibi sade Türkçe ile yazın.
- `languageLesson` ve `languageNotes` alanlarında programlama kavramlarını Türkçe açıklayın, ancak kavramın İngilizce adını koruyun (ör. "**Generic** tipler, bir fonksiyonun farklı tiplerle çalışmasını sağlar.").
