# Test audio

## `ja-iwata-san-no-kuruma.wav`

"私たちは岩田さんの車でいきました。" ("We went in Mr. Iwata's car."), read in
Japanese. 3.16 s of 16-bit PCM, 48 kHz, mono. Kept exactly as published.

| | |
|---|---|
| Source | [LL-Q5287 (jpn)-Zsrtrgh-私たちは岩田さんの車でいきました。.wav](https://commons.wikimedia.org/wiki/File:LL-Q5287_(jpn)-Zsrtrgh-%E7%A7%81%E3%81%9F%E3%81%A1%E3%81%AF%E5%B2%A9%E7%94%B0%E3%81%95%E3%82%93%E3%81%AE%E8%BB%8A%E3%81%A7%E3%81%84%E3%81%8D%E3%81%BE%E3%81%97%E3%81%9F%E3%80%82.wav), Wikimedia Commons, recorded with [Lingua Libre](https://lingualibre.org/) |
| Speaker | [Zsrtrgh](https://lingualibre.org/wiki/Q1564396) |
| Uploaded | 2025-10-14 |
| License | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| SHA-1 | `451c7262b0d4a97c031682e6ec4d1ce88e93ca4e`, the same as on Commons |

To check that the file is the one published, compare its SHA-1 with the one
the Commons API gives:

```bash
shasum tests/large/fixtures/ja-iwata-san-no-kuruma.wav
curl -sG https://commons.wikimedia.org/w/api.php \
  --data-urlencode action=query --data-urlencode prop=imageinfo \
  --data-urlencode iiprop=sha1 --data-urlencode format=json \
  --data-urlencode 'titles=File:LL-Q5287 (jpn)-Zsrtrgh-私たちは岩田さんの車でいきました。.wav'
```
