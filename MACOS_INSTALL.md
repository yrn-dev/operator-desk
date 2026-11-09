# Собрать Operator Desktop на macOS

Готовые `.app` и `.dmg` не публикуются: соберите приложение на своём Mac.
Нужны Node.js 22.19+ и интернет.

```bash
git clone https://github.com/yrn-dev/operator-desk.git
cd operator-desk
npm ci
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac
open release
```

В `release/` появятся `.dmg` и `.zip` для Apple Silicon и Intel. Подписи Apple
у сборки нет; при первом запуске macOS может попросить подтвердить открытие.
Разрешения Screen Recording и Accessibility нужны только для управления другими окнами.
