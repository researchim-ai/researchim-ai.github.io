/* ============================================================
   researchim.ai — интерактив
   ============================================================ */
(function () {
	"use strict";

	var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	/* ---------- Год в футере ---------- */
	var yearEl = document.getElementById("year");
	if (yearEl) yearEl.textContent = new Date().getFullYear();

	/* ---------- Навигация: фон при скролле + прогресс ---------- */
	var nav = document.getElementById("nav");
	var progress = document.getElementById("scrollProgress");

	function onScroll() {
		var y = window.scrollY || window.pageYOffset;
		if (nav) nav.classList.toggle("scrolled", y > 24);

		if (progress) {
			var h = document.documentElement.scrollHeight - window.innerHeight;
			var p = h > 0 ? (y / h) * 100 : 0;
			progress.style.width = p + "%";
		}
	}
	window.addEventListener("scroll", onScroll, { passive: true });
	onScroll();

	/* ---------- Мобильное меню ---------- */
	var burger = document.getElementById("navBurger");
	var links = document.querySelector(".nav__links");
	if (burger && links) {
		burger.addEventListener("click", function () {
			var open = links.classList.toggle("open");
			burger.setAttribute("aria-expanded", open ? "true" : "false");
		});
		links.querySelectorAll("a").forEach(function (a) {
			a.addEventListener("click", function () {
				links.classList.remove("open");
				burger.setAttribute("aria-expanded", "false");
			});
		});
	}

	/* ---------- Reveal при скролле ---------- */
	var revealEls = document.querySelectorAll(".reveal");
	if ("IntersectionObserver" in window && !reduceMotion) {
		var io = new IntersectionObserver(function (entries) {
			entries.forEach(function (entry) {
				if (entry.isIntersecting) {
					entry.target.classList.add("is-visible");
					io.unobserve(entry.target);
				}
			});
		}, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
		revealEls.forEach(function (el) { io.observe(el); });
	} else {
		revealEls.forEach(function (el) { el.classList.add("is-visible"); });
	}

	/* ---------- Счётчик в hero ---------- */
	var counters = document.querySelectorAll("[data-count]");
	counters.forEach(function (el) {
		var target = parseInt(el.getAttribute("data-count"), 10) || 0;
		if (reduceMotion) { el.textContent = String(target); return; }
		var start = null, dur = 1200;
		function step(ts) {
			if (!start) start = ts;
			var t = Math.min((ts - start) / dur, 1);
			var eased = 1 - Math.pow(1 - t, 3);
			el.textContent = String(Math.round(eased * target));
			if (t < 1) requestAnimationFrame(step);
		}
		requestAnimationFrame(step);
	});

	/* ---------- Фильтр проектов ---------- */
	var filterBar = document.getElementById("projectFilters");
	var grid = document.getElementById("projectsGrid");
	if (filterBar && grid) {
		var cards = Array.prototype.slice.call(grid.querySelectorAll(".project"));
		filterBar.addEventListener("click", function (e) {
			var btn = e.target.closest(".filter");
			if (!btn) return;
			var f = btn.getAttribute("data-filter");

			filterBar.querySelectorAll(".filter").forEach(function (b) {
				b.classList.toggle("is-active", b === btn);
			});

			cards.forEach(function (card) {
				var show = f === "all" || card.getAttribute("data-cat") === f;
				card.classList.toggle("is-hidden", !show);
			});
		});
	}

	/* ============================================================
	   RL-песочница: табличный Q-learning в гридворлде
	   ============================================================ */
	(function initRLGame() {
		var cv = document.getElementById("gameCanvas");
		var chart = document.getElementById("rewardChart");
		if (!cv || !chart) return;

		var g = cv.getContext("2d");
		var gc = chart.getContext("2d");

		// --- Среда (гридворлд) ---
		var COLS = 8, ROWS = 6;
		var START = { c: 0, r: ROWS - 1 };
		var GOAL = { c: COLS - 1, r: 0 };
		var PITS = [
			{ c: 2, r: 1 }, { c: 2, r: 2 }, { c: 2, r: 3 },
			{ c: 5, r: 4 }, { c: 5, r: 3 }, { c: 5, r: 2 },
			{ c: 4, r: 0 }
		];
		var ACTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up, right, down, left

		function isPit(c, r) {
			for (var i = 0; i < PITS.length; i++) if (PITS[i].c === c && PITS[i].r === r) return true;
			return false;
		}
		function isGoal(c, r) { return c === GOAL.c && r === GOAL.r; }
		function sid(c, r) { return r * COLS + c; }

		// --- Q-таблица ---
		var Q, epsilon, episode, best, rewardHistory;
		function resetLearning() {
			Q = new Float32Array(COLS * ROWS * 4);
			epsilon = 1.0;
			episode = 0;
			best = null;
			rewardHistory = [];
			agent = { c: START.c, r: START.r };
			mode = "idle";
			updateStats(0);
			drawChart();
			draw();
			setHint('Нажмите <b>«Обучить агента»</b> — и смотрите, как растёт награда, а по клеткам проявляется выученная политика. Или играйте сами: <b>стрелки / WASD</b>.');
		}

		function step(c, r, a) {
			var nc = c + ACTIONS[a][0], nr = r + ACTIONS[a][1];
			if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) { nc = c; nr = r; }
			var reward = -0.02, done = false;
			if (isGoal(nc, nr)) { reward = 1.0; done = true; }
			else if (isPit(nc, nr)) { reward = -1.0; done = true; }
			return { c: nc, r: nr, reward: reward, done: done };
		}

		function greedyAction(s) {
			var base = s * 4, bestA = 0, bestV = Q[base];
			for (var a = 1; a < 4; a++) if (Q[base + a] > bestV) { bestV = Q[base + a]; bestA = a; }
			return bestA;
		}

		// --- Один обучающий эпизод ---
		var alpha = 0.15, gamma = 0.95;
		function runEpisode() {
			var c = START.c, r = START.r, total = 0, steps = 0;
			while (steps < 120) {
				var s = sid(c, r);
				var a = Math.random() < epsilon ? (Math.random() * 4) | 0 : greedyAction(s);
				var res = step(c, r, a);
				var ns = sid(res.c, res.r);
				var target = res.reward + (res.done ? 0 : gamma * Q[ns * 4 + greedyAction(ns)]);
				Q[s * 4 + a] += alpha * (target - Q[s * 4 + a]);
				total += res.reward;
				c = res.c; r = res.r; steps++;
				if (res.done) break;
			}
			episode++;
			epsilon = Math.max(0.05, epsilon * 0.985);
			rewardHistory.push(total);
			if (rewardHistory.length > 400) rewardHistory.shift();
			if (best === null || total > best) best = total;
			return total;
		}

		// --- Состояние UI ---
		var agent = { c: START.c, r: START.r };
		var mode = "idle"; // idle | training | watching | play
		var lastReward = 0;
		var trainTimer = null, watchTimer = null;

		var elEp = document.getElementById("statEpisode");
		var elRw = document.getElementById("statReward");
		var elBest = document.getElementById("statBest");
		var elEps = document.getElementById("statEps");
		var hint = document.getElementById("gameHint");
		function setHint(html) { if (hint) hint.innerHTML = html; }
		function updateStats(r) {
			elEp.textContent = String(episode);
			elRw.textContent = r.toFixed(2);
			elBest.textContent = best === null ? "—" : best.toFixed(2);
			elEps.textContent = epsilon.toFixed(2);
		}

		// --- Отрисовка поля ---
		var cell = 60;
		function sizeCanvas() {
			var wrap = cv.parentElement.clientWidth;
			cell = Math.max(38, Math.min(64, Math.floor(wrap / COLS)));
			var dpr = Math.min(window.devicePixelRatio || 1, 2);
			cv.width = COLS * cell * dpr;
			cv.height = ROWS * cell * dpr;
			cv.style.height = (ROWS * cell) + "px";
			g.setTransform(dpr, 0, 0, dpr, 0, 0);
			draw();
		}

		function valueAt(c, r) {
			var base = sid(c, r) * 4, v = Q[base];
			for (var a = 1; a < 4; a++) if (Q[base + a] > v) v = Q[base + a];
			return v;
		}

		function draw() {
			var W = COLS * cell, H = ROWS * cell;
			g.clearRect(0, 0, W, H);

			for (var r = 0; r < ROWS; r++) {
				for (var c = 0; c < COLS; c++) {
					var x = c * cell, y = r * cell;

					// фон клетки по функции ценности (зелёный heatmap)
					var v = valueAt(c, r);
					var t = Math.max(0, Math.min(1, v)); // 0..1
					g.fillStyle = "rgba(52,211,153," + (0.05 + t * 0.55).toFixed(3) + ")";
					g.fillRect(x, y, cell, cell);

					// сетка
					g.strokeStyle = "rgba(255,255,255,0.06)";
					g.lineWidth = 1;
					g.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);

					if (isPit(c, r)) {
						g.fillStyle = "rgba(242,85,90,0.9)";
						roundRect(x + 6, y + 6, cell - 12, cell - 12, 8); g.fill();
						g.fillStyle = "#2a0d0f"; g.font = "bold " + (cell * 0.34) + "px " + monoFont();
						g.textAlign = "center"; g.textBaseline = "middle";
						g.fillText("−1", x + cell / 2, y + cell / 2 + 1);
					} else if (isGoal(c, r)) {
						g.fillStyle = "rgba(52,211,153,0.95)";
						roundRect(x + 6, y + 6, cell - 12, cell - 12, 8); g.fill();
						g.fillStyle = "#05231a"; g.font = "bold " + (cell * 0.34) + "px " + monoFont();
						g.textAlign = "center"; g.textBaseline = "middle";
						g.fillText("+1", x + cell / 2, y + cell / 2 + 1);
					} else if (v > 0.01) {
						// стрелка политики
						drawArrow(x + cell / 2, y + cell / 2, greedyAction(sid(c, r)), cell);
					}
				}
			}

			// агент
			var ax = agent.c * cell + cell / 2, ay = agent.r * cell + cell / 2;
			g.beginPath();
			g.arc(ax, ay, cell * 0.28, 0, Math.PI * 2);
			g.fillStyle = "#6ee7b7";
			g.shadowColor = "rgba(110,231,183,0.9)"; g.shadowBlur = 14;
			g.fill();
			g.shadowBlur = 0;
			g.fillStyle = "#05231a"; g.beginPath();
			g.arc(ax, ay, cell * 0.11, 0, Math.PI * 2); g.fill();
		}

		function drawArrow(cx, cy, a, size) {
			var dir = ACTIONS[a];
			var len = size * 0.2;
			g.strokeStyle = "rgba(230,240,235,0.5)";
			g.fillStyle = "rgba(230,240,235,0.5)";
			g.lineWidth = 1.5;
			var ex = cx + dir[0] * len, ey = cy + dir[1] * len;
			g.beginPath(); g.moveTo(cx - dir[0] * len, cy - dir[1] * len); g.lineTo(ex, ey); g.stroke();
			var ang = Math.atan2(dir[1], dir[0]);
			g.beginPath();
			g.moveTo(ex, ey);
			g.lineTo(ex - size * 0.09 * Math.cos(ang - 0.5), ey - size * 0.09 * Math.sin(ang - 0.5));
			g.lineTo(ex - size * 0.09 * Math.cos(ang + 0.5), ey - size * 0.09 * Math.sin(ang + 0.5));
			g.closePath(); g.fill();
		}

		function roundRect(x, y, w, h, r) {
			g.beginPath();
			g.moveTo(x + r, y);
			g.arcTo(x + w, y, x + w, y + h, r);
			g.arcTo(x + w, y + h, x, y + h, r);
			g.arcTo(x, y + h, x, y, r);
			g.arcTo(x, y, x + w, y, r);
			g.closePath();
		}
		function monoFont() { return '"JetBrains Mono", monospace'; }

		// --- График награды ---
		function drawChart() {
			var W = chart.clientWidth || 480, H = chart.clientHeight || 90;
			var dpr = Math.min(window.devicePixelRatio || 1, 2);
			chart.width = W * dpr; chart.height = H * dpr;
			gc.setTransform(dpr, 0, 0, dpr, 0, 0);
			gc.clearRect(0, 0, W, H);

			// нулевая линия
			var padY = 10;
			var min = -1.2, max = 1.05;
			function yAt(v) { return padY + (1 - (v - min) / (max - min)) * (H - padY * 2); }
			gc.strokeStyle = "rgba(255,255,255,0.12)";
			gc.lineWidth = 1;
			gc.beginPath(); gc.moveTo(0, yAt(0)); gc.lineTo(W, yAt(0)); gc.stroke();

			if (rewardHistory.length < 2) return;
			gc.beginPath();
			gc.strokeStyle = "#34d399";
			gc.lineWidth = 1.8;
			for (var i = 0; i < rewardHistory.length; i++) {
				var x = (i / (rewardHistory.length - 1)) * W;
				var y = yAt(Math.max(min, Math.min(max, rewardHistory[i])));
				if (i === 0) gc.moveTo(x, y); else gc.lineTo(x, y);
			}
			gc.stroke();
		}

		// --- Управление режимами ---
		function stopTimers() {
			if (trainTimer) { clearInterval(trainTimer); trainTimer = null; }
			if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
		}

		function train() {
			stopTimers();
			mode = "training";
			agent = { c: START.c, r: START.r };
			setHint('Идёт обучение… ε (доля случайных ходов) снижается — агент всё меньше исследует и всё чаще действует по выученной политике.');
			var totalTarget = 500;
			trainTimer = setInterval(function () {
				for (var k = 0; k < 8; k++) { lastReward = runEpisode(); if (episode >= totalTarget) break; }
				updateStats(lastReward);
				drawChart();
				draw();
				if (episode >= totalTarget) {
					stopTimers();
					mode = "idle";
					setHint('Готово — агент обучен за <b>' + episode + '</b> эпизодов. Нажмите <b>«Смотреть политику»</b>, чтобы увидеть жадный проход к награде.');
				}
			}, 30);
		}

		function watch() {
			stopTimers();
			if (episode === 0) { setHint('Сначала обучите агента 🙂'); return; }
			mode = "watching";
			agent = { c: START.c, r: START.r };
			setHint('Агент идёт <b>жадно</b> по выученной политике (без случайности).');
			var steps = 0;
			(function tick() {
				draw();
				if (isGoal(agent.c, agent.r)) { setHint('Награда достигнута ✅ Политика работает.'); mode = "idle"; return; }
				if (isPit(agent.c, agent.r) || steps > 60) { mode = "idle"; return; }
				var a = greedyAction(sid(agent.c, agent.r));
				var res = step(agent.c, agent.r, a);
				agent = { c: res.c, r: res.r };
				steps++;
				watchTimer = setTimeout(tick, 220);
			})();
		}

		function playMode() {
			stopTimers();
			mode = "play";
			agent = { c: START.c, r: START.r };
			draw();
			setHint('Ваш ход! Двигайтесь <b>стрелками</b> или <b>WASD</b> к зелёной клетке <b>+1</b>, избегая красных −1.');
		}

		function playMove(a) {
			if (mode !== "play") return;
			var res = step(agent.c, agent.r, a);
			agent = { c: res.c, r: res.r };
			draw();
			if (res.done && res.reward > 0) { setHint('Победа! Награда <b>+1</b> 🎉 Нажмите «Играть самому», чтобы попробовать снова.'); mode = "idle"; }
			else if (res.done) { setHint('Упс, штраф <b>−1</b>. Попробуйте ещё раз.'); mode = "idle"; }
		}

		// --- Кнопки ---
		document.getElementById("btnTrain").addEventListener("click", train);
		document.getElementById("btnWatch").addEventListener("click", watch);
		document.getElementById("btnPlay").addEventListener("click", playMode);
		document.getElementById("btnReset").addEventListener("click", function () { stopTimers(); resetLearning(); });

		// --- Клавиатура для игры ---
		window.addEventListener("keydown", function (e) {
			if (mode !== "play") return;
			var map = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
			if (e.code in map) { e.preventDefault(); playMove(map[e.code]); }
		});
		// --- Тап/клик по соседней клетке в режиме игры ---
		cv.addEventListener("click", function (e) {
			if (mode !== "play") return;
			var rect = cv.getBoundingClientRect();
			var c = Math.floor((e.clientX - rect.left) / (rect.width / COLS));
			var r = Math.floor((e.clientY - rect.top) / (rect.height / ROWS));
			var dc = c - agent.c, dr = r - agent.r;
			if (Math.abs(dc) + Math.abs(dr) !== 1) return;
			if (dr === -1) playMove(0); else if (dc === 1) playMove(1);
			else if (dr === 1) playMove(2); else if (dc === -1) playMove(3);
		});

		window.addEventListener("resize", function () { sizeCanvas(); drawChart(); });

		resetLearning();
		sizeCanvas();
		drawChart();
	})();

	/* ---------- Анимированный фон: сеть частиц ---------- */
	var canvas = document.getElementById("bg-canvas");
	if (!canvas || reduceMotion) return;
	var ctx = canvas.getContext("2d");
	if (!ctx) return;

	var w, h, dpr, particles = [];
	var mouse = { x: -9999, y: -9999 };

	function resize() {
		dpr = Math.min(window.devicePixelRatio || 1, 2);
		w = canvas.clientWidth = window.innerWidth;
		h = canvas.clientHeight = window.innerHeight;
		canvas.width = w * dpr;
		canvas.height = h * dpr;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		var target = Math.min(90, Math.floor((w * h) / 16000));
		particles = [];
		for (var i = 0; i < target; i++) {
			particles.push({
				x: Math.random() * w,
				y: Math.random() * h,
				vx: (Math.random() - 0.5) * 0.35,
				vy: (Math.random() - 0.5) * 0.35,
				r: Math.random() * 1.6 + 0.6
			});
		}
	}

	function hexTint(t) {
		// Интерполяция в зелёной гамме: bright (110,231,183) → deep (16,185,129)
		var r = Math.round(110 + (16 - 110) * t);
		var g = Math.round(231 + (185 - 231) * t);
		var b = Math.round(183 + (129 - 183) * t);
		return r + "," + g + "," + b;
	}

	var linkDist = 130;

	function draw() {
		ctx.clearRect(0, 0, w, h);

		for (var i = 0; i < particles.length; i++) {
			var p = particles[i];
			p.x += p.vx;
			p.y += p.vy;

			if (p.x < 0 || p.x > w) p.vx *= -1;
			if (p.y < 0 || p.y > h) p.vy *= -1;

			// лёгкое притяжение к курсору
			var mdx = mouse.x - p.x, mdy = mouse.y - p.y;
			var md2 = mdx * mdx + mdy * mdy;
			if (md2 < 26000) {
				p.x += mdx * 0.0009;
				p.y += mdy * 0.0009;
			}

			var tint = hexTint(p.x / w);
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
			ctx.fillStyle = "rgba(" + tint + ",0.8)";
			ctx.fill();
		}

		// связи
		for (var a = 0; a < particles.length; a++) {
			for (var b = a + 1; b < particles.length; b++) {
				var pa = particles[a], pb = particles[b];
				var dx = pa.x - pb.x, dy = pa.y - pb.y;
				var d = Math.sqrt(dx * dx + dy * dy);
				if (d < linkDist) {
					var alpha = (1 - d / linkDist) * 0.32;
					var tint2 = hexTint(pa.x / w);
					ctx.beginPath();
					ctx.moveTo(pa.x, pa.y);
					ctx.lineTo(pb.x, pb.y);
					ctx.strokeStyle = "rgba(" + tint2 + "," + alpha + ")";
					ctx.lineWidth = 1;
					ctx.stroke();
				}
			}
		}

		requestAnimationFrame(draw);
	}

	window.addEventListener("resize", resize);
	window.addEventListener("mousemove", function (e) {
		mouse.x = e.clientX;
		mouse.y = e.clientY;
	});
	window.addEventListener("mouseout", function () {
		mouse.x = -9999; mouse.y = -9999;
	});

	resize();
	requestAnimationFrame(draw);
})();
