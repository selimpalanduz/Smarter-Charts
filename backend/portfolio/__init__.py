"""Portfolio: holdings entered by hand, their return, and a benchmark to read it against.

Trades are stored exactly as they were made — the share count and the price
of that day, unadjusted. The price series they are measured against is
bonus-adjusted, so everything is converted into adjusted units on the way
out, never on the way in. Storing the adjusted figure would rot: the next
bonus issue changes it.

Portföy: elle girilen pozisyonlar, getirileri ve kıyaslanacak bir ölçüt.

İşlemler yapıldığı gibi saklanıyor — o günün adedi ve o günün fiyatı,
düzeltilmemiş. Karşılaştırıldıkları fiyat serisi bedelsize göre düzeltilmiş
olduğundan çevrim okurken yapılıyor, yazarken değil. Düzeltilmiş hâli
saklamak çürürdü: bir sonraki bedelsiz onu değiştirir.
"""
