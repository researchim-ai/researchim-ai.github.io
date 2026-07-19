# researchim.ai

Официальный сайт исследовательской группы **researchim** — исследования в области
искусственного интеллекта: reasoning, обучение с подкреплением (RL), большие языковые
модели (LLM), tool calling и прикладной ИИ.

🌐 **Сайт:** https://researchim-ai.github.io
💬 **Telegram:** https://t.me/researchim
🐙 **GitHub:** https://github.com/researchim-ai

## Стек

Статический сайт без сборки — идеально для GitHub Pages:

- `index.html` — разметка
- `src/main.css` — стили (тёмная тема, glassmorphism, адаптив)
- `src/app.js` — интерактив (анимированный фон-нейросеть на Canvas, scroll-reveal, навигация)
- `src/favicon.svg` — иконка

## Локальный запуск

```bash
python3 server.py   # http://localhost:8111
```

или любой статический сервер:

```bash
python3 -m http.server 8111
```
