import Chart from 'chart.js/auto';
import { INITIAL_ROUTINE } from './routine-data.js';
import { auth, db, googleProvider } from './firebase.js';
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

// Core State Manager
class FemmeFitApp {
  constructor() {
    this.state = this.loadState();
    this.timerInterval = null;
    this.timerRemaining = 0;
    this.timerTarget = 120;
    this.isTimerPaused = false;
    this.activeWarmupTimer = null;
    this.activeCooldownTimer = null;
    this.activeHipopresivosTimer = null;
    this.chartInstance = null;
    // Firebase
    this.userId = null;
    this.firestoreSyncTimeout = null;
  }

  // Load state from localStorage or initialize defaults
  loadState() {
    const saved = localStorage.getItem('femmefit_state');
    const todayStr = this.getTodayDateString();

    const defaultState = {
      routine: INITIAL_ROUTINE,
      activeDay: 'lunes',
      completedSteps: {}, // { 'yyyy-mm-dd': { stepId: true } }
      logs: [], // [ { date, dayId, completed: true } ]
      weightsHistory: [], // [ { exerciseId, exerciseName, date, sets: [{ setNum, weight, reps, done }] } ]
      bodyWeightLogs: [
        { date: '2026-05-15', weight: 60.5 },
        { date: '2026-05-22', weight: 60.1 },
        { date: '2026-05-29', weight: 59.8 },
        { date: '2026-06-05', weight: 59.5 }
      ],
      waterLogs: {}, // { 'yyyy-mm-dd': count }
      foodLogs: {}, // { 'yyyy-mm-dd': [ { id, desc, cal, prot, carb, fat } ] }
      periodLogs: [], // [ { date: 'yyyy-mm-dd' } ]
      cycleSymptoms: {}, // { 'yyyy-mm-dd': { cramps, fatigue, strength, bloating } }
      manualCyclePhase: null, // override
      manualCyclePhaseDate: null,
      cycleLength: 28, // default average length
      currentWorkoutLogs: {} // Temporary log of current active workout sets { exerciseId: [{weight, reps, done}] }
    };

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Deep merge or restore essential keys if missing
        if (!parsed.routine) parsed.routine = INITIAL_ROUTINE;
        if (!parsed.bodyWeightLogs) parsed.bodyWeightLogs = defaultState.bodyWeightLogs;
        if (!parsed.waterLogs) parsed.waterLogs = {};
        if (!parsed.foodLogs) parsed.foodLogs = {};
        if (!parsed.periodLogs) parsed.periodLogs = [];
        if (!parsed.cycleSymptoms) parsed.cycleSymptoms = {};
        if (!parsed.currentWorkoutLogs) parsed.currentWorkoutLogs = {};

        // Upgrade simple date logs to ranges
        parsed.periodLogs = parsed.periodLogs.map(p => {
          if (p.date && !p.startDate) {
            const start = p.date;
            const startDateObj = new Date(start);
            startDateObj.setDate(startDateObj.getDate() + 4); // assume default 5 days duration
            const end = startDateObj.toISOString().split('T')[0];
            return {
              id: p.id || Date.now() + Math.random(),
              startDate: start,
              endDate: end
            };
          }
          if (!p.id) p.id = Date.now() + Math.random();
          return p;
        });

        return parsed;
      } catch (e) {
        console.error("Error parsing saved state, resetting...", e);
        return defaultState;
      }
    }
    return defaultState;
  }

  saveState() {
    localStorage.setItem('femmefit_state', JSON.stringify(this.state));
    this.debouncedFirestoreSync(); // also persist to cloud
  }

  // ── Firestore Sync ──────────────────────────────────────────────
  debouncedFirestoreSync() {
    if (this.firestoreSyncTimeout) clearTimeout(this.firestoreSyncTimeout);
    this.firestoreSyncTimeout = setTimeout(() => this.syncToFirestore(), 2000);
  }

  async syncToFirestore() {
    if (!this.userId) return;
    try {
      const ref = doc(db, 'users', this.userId, 'state', 'main');
      await setDoc(ref, { data: JSON.stringify(this.state), updatedAt: Date.now() });
    } catch (e) {
      console.warn('Firestore sync failed (offline?), data saved locally:', e.message);
    }
  }

  async loadFromFirestore(uid) {
    try {
      const ref = doc(db, 'users', uid, 'state', 'main');
      const snap = await getDoc(ref);
      if (snap.exists() && snap.data().data) {
        const cloudState = JSON.parse(snap.data().data);
        // Cloud takes priority; fill any missing keys from local defaults
        this.state = { ...this.state, ...cloudState };

        // Upgrade simple date logs to ranges
        if (this.state.periodLogs) {
          this.state.periodLogs = this.state.periodLogs.map(p => {
            if (p.date && !p.startDate) {
              const start = p.date;
              const startDateObj = new Date(start);
              startDateObj.setDate(startDateObj.getDate() + 4);
              const end = startDateObj.toISOString().split('T')[0];
              return {
                id: p.id || Date.now() + Math.random(),
                startDate: start,
                endDate: end
              };
            }
            if (!p.id) p.id = Date.now() + Math.random();
            return p;
          });
        }
      } else {
        // First login ever — upload current local data to cloud
        await this.syncToFirestore();
      }
      localStorage.setItem('femmefit_state', JSON.stringify(this.state));
    } catch (e) {
      console.error('Could not load from Firestore, using local data:', e.message);
    }
  }

  // ── User profile in header ───────────────────────────────────────
  showUserInfo(user) {
    const headerUser = document.getElementById('header-user');
    const avatar = document.getElementById('user-avatar');
    if (headerUser) headerUser.style.display = 'flex';
    if (avatar && user.photoURL) {
      avatar.src = user.photoURL;
      avatar.alt = user.displayName || 'Usuario';
    }
  }

  getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  init() {
    // Render Icons
    lucide.createIcons();

    // Set Default Active Day based on Day of Week
    const daysOfWeek = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const currentDayIndex = new Date().getDay();
    let currentDayName = daysOfWeek[currentDayIndex];
    if (currentDayName === 'sabado' || currentDayName === 'domingo') {
      currentDayName = 'lunes'; // default to Monday for workouts on weekends
    }
    this.state.activeDay = currentDayName;

    // Render Views
    this.renderActiveDaySelection();
    this.renderWorkoutFlow();
    this.renderRoutineEditor();
    this.renderNutritionTab();
    this.renderCycleTab();
    this.updateCoachWidget();
    
    // Set up Date inputs to default to today
    const periodInput = document.getElementById('input-period-date');
    if (periodInput) periodInput.value = this.getTodayDateString();

    // Initialize Weight Chart
    this.renderWeightChart();

    // Set up Global Listeners
    this.setupListeners();
  }

  setupListeners() {
    // Warmup Timer
    const btnWarmup = document.getElementById('btn-start-warmup');
    if (btnWarmup) {
      btnWarmup.addEventListener('click', () => {
        const dayId = this.state.activeDay;
        const dayData = this.state.routine.days.find(d => d.id === dayId);
        let duration = 300; // 5 min
        if (dayData && dayData.warmup && dayData.warmup.duration) {
          const match = dayData.warmup.duration.match(/(\d+)/);
          if (match) duration = parseInt(match[1]) * 60;
        }
        this.startTimer(duration, false, "Calentamiento General", "warmup");
      });
    }

    // Cooldown Timer
    const btnCooldown = document.getElementById('btn-start-cooldown');
    if (btnCooldown) {
      btnCooldown.addEventListener('click', () => {
        const dayId = this.state.activeDay;
        const dayData = this.state.routine.days.find(d => d.id === dayId);
        let duration = 180; // 3 min
        if (dayData && dayData.cooldown && dayData.cooldown.walk) {
          const match = dayData.cooldown.walk.match(/(\d+)/);
          if (match) duration = parseInt(match[1]) * 60;
        }
        this.startTimer(duration, false, "Vuelta a la Calma", "cooldown");
      });
    }

    // Hipopresivos Timer
    const btnHipo = document.getElementById('btn-start-hipopresivos');
    if (btnHipo) {
      btnHipo.addEventListener('click', () => {
        const dayId = this.state.activeDay;
        const routineDay = this.state.routine.days.find(d => d.id === dayId);
        let duration = 600; // default 10 min
        if (routineDay) {
          const durationStr = this.state.routine.hipopresivosDefaults[dayId] || "10 min";
          const match = durationStr.match(/(\d+)/);
          if (match) duration = parseInt(match[1]) * 60;
        }
        this.startTimer(duration, false, "Hipopresivos Diarios", "hipopresivos");
      });
    }

    // End Workout Button
    const btnComplete = document.getElementById('btn-complete-workout');
    if (btnComplete) {
      btnComplete.addEventListener('click', () => this.completeFullWorkout());
    }
  }

  // TAB SWITCHING
  switchTab(tabId, el) {
    // Hide all views
    document.querySelectorAll('.view-container').forEach(view => {
      view.classList.remove('active');
    });
    // Show active view
    const targetView = document.getElementById(`view-${tabId}`);
    if (targetView) targetView.classList.add('active');

    // Update nav classes
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
    });
    el.classList.add('active');

    // Trigger tab specific renders
    if (tabId === 'progreso') {
      setTimeout(() => {
        this.renderWeightChart();
        this.populateExerciseSelectors();
        this.renderExerciseHistory();
      }, 50);
    } else if (tabId === 'alimentacion') {
      this.renderNutritionTab();
    } else if (tabId === 'ciclo') {
      this.renderCycleTab();
    }
  }

  getTodaySymptoms() {
    const todayStr = this.getTodayDateString();
    return this.state.cycleSymptoms[todayStr] || {
      cramps: 'ninguno',
      fatigue: 'normal',
      strength: 'normal',
      bloating: 'ninguna'
    };
  }

  getSymptomRecommendation(symptoms = this.getTodaySymptoms()) {
    const hasStrongCramps = symptoms.cramps === 'fuerte';
    const hasModerateCramps = symptoms.cramps === 'moderado';
    const hasLowEnergy = symptoms.fatigue === 'baja';
    const hasWeakStrength = symptoms.strength === 'debil';
    const hasHighBloating = symptoms.bloating === 'alta';
    const feelsGreat = symptoms.fatigue === 'alta' && symptoms.strength === 'excelente' && symptoms.cramps === 'ninguno';

    if (hasStrongCramps || (hasLowEnergy && hasWeakStrength)) {
      return {
        level: 'reduce',
        badge: 'Bajar intensidad',
        header: 'Día suave',
        border: 'var(--phase-menstrual)',
        advice: '<strong>Hoy conviene bajarle.</strong> Reduce cargas a un 60-70%, evita buscar récords y prioriza técnica, movilidad, caminata suave o hipopresivos. Si el dolor es fuerte, está bien hacer solo recuperación.'
      };
    }

    if (hasModerateCramps || hasLowEnergy || hasWeakStrength || hasHighBloating) {
      return {
        level: 'adjust',
        badge: 'Ajustar entrenamiento',
        header: 'Con control',
        border: 'var(--phase-lutea)',
        advice: '<strong>Haz la rutina, pero sin forzar.</strong> Mantén la técnica limpia, baja 5-15% la carga si algo se siente pesado y deja 1-2 repeticiones en reserva. El cardio debe sentirse cómodo, no castigador.'
      };
    }

    if (feelsGreat) {
      return {
        level: 'push',
        badge: 'Buen día para progresar',
        header: 'Progresar',
        border: 'var(--phase-ovulacion)',
        advice: '<strong>Hoy puedes empujar progreso.</strong> Si la técnica está sólida, intenta completar el rango alto de repeticiones o subir un poco la carga en los ejercicios principales.'
      };
    }

    return {
      level: 'normal',
      badge: 'Entreno normal',
      header: 'Normal',
      border: 'var(--phase-folicular)',
      advice: '<strong>Hoy sigue la rutina normal.</strong> Trabaja con buena técnica, registra tus series y ajusta solo si aparece dolor, fatiga fuerte o una caída clara de fuerza.'
    };
  }

  updateCoachWidget() {
    const recommendation = this.getSymptomRecommendation();
    const widget = document.getElementById('today-coach-widget');
    const phaseBadge = document.getElementById('today-coach-phase');
    const adviceText = document.getElementById('today-coach-text');
    const headerBadge = document.getElementById('header-cycle-badge');

    if (!widget || !phaseBadge || !adviceText) return;

    phaseBadge.className = `cycle-phase-badge symptom-${recommendation.level}`;
    phaseBadge.innerText = recommendation.badge;
    adviceText.innerHTML = recommendation.advice;
    widget.style.borderLeft = `4px solid ${recommendation.border}`;

    if (headerBadge) {
      headerBadge.style.display = 'inline-block';
      headerBadge.className = `cycle-phase-badge symptom-${recommendation.level}`;
      headerBadge.innerText = recommendation.header;
    }
  }

  // RENDER WORKOUT FLOW (TAB HOY)
  renderActiveDaySelection() {
    const selector = document.getElementById('day-selector');
    if (!selector) return;

    selector.innerHTML = '';
    this.state.routine.days.forEach(day => {
      const activeClass = this.state.activeDay === day.id ? 'active' : '';
      const button = document.createElement('button');
      button.className = `pill ${activeClass}`;
      button.innerText = day.name.substring(0, 3);
      button.setAttribute('data-day', day.id);
      button.addEventListener('click', () => {
        this.state.activeDay = day.id;
        document.querySelectorAll('#day-selector .pill').forEach(b => b.classList.remove('active'));
        button.classList.add('active');
        this.renderWorkoutFlow();
      });
      selector.appendChild(button);
    });
  }

  renderWorkoutFlow() {
    const dayId = this.state.activeDay;
    const dayData = this.state.routine.days.find(d => d.id === dayId);
    if (!dayData) return;

    // Reset checkboxes and step visual state
    const todayStr = this.getTodayDateString();
    if (!this.state.completedSteps[todayStr]) {
      this.state.completedSteps[todayStr] = {};
    }

    // Update Header titles
    document.getElementById('today-workout-name').innerText = `${dayData.name} — ${dayData.focus}`;
    document.getElementById('today-workout-focus').innerText = dayData.cardio ? "Incluye Cardio al final" : "Sin Cardio formal";

    // Setup Calentamiento General
    document.getElementById('warmup-subtitle').innerText = `${dayData.warmup.duration} • Calentamiento General`;
    document.getElementById('warmup-desc').innerText = dayData.warmup.description;
    const checkWarmup = document.getElementById('check-warmup-done');
    checkWarmup.checked = !!this.state.completedSteps[todayStr]['step-warmup'];
    this.completeStepVisual('step-warmup', checkWarmup.checked);

    // Warmup Video Button setup
    const btnWarmupVideo = document.getElementById('btn-warmup-video');
    if (btnWarmupVideo) {
      if (dayData.warmup.video) {
        btnWarmupVideo.style.display = 'inline-flex';
        btnWarmupVideo.onclick = () => this.playVideo('Calentamiento General', dayData.warmup.video);
      } else {
        btnWarmupVideo.style.display = 'none';
      }
    }

    // Setup Movilidad
    const mobilityList = document.getElementById('mobility-exercises-list');
    mobilityList.innerHTML = '';
    dayData.mobility.exercises.forEach((ex, idx) => {
      const div = document.createElement('div');
      div.className = 'check-item';
      div.style.display = 'flex';
      div.style.justifyContent = 'space-between';
      div.style.alignItems = 'center';
      
      div.innerHTML = `
        <label style="display:flex; align-items:center; gap:10px; cursor:pointer;">
          <input type="checkbox" id="check-mob-${idx}" ${this.state.completedSteps[todayStr][`mob-${idx}`] ? 'checked' : ''} onchange="app.saveCheckState('mob-${idx}', this.checked)" />
          <div class="custom-checkbox"></div>
          <span>${ex.name} (${ex.reps})</span>
        </label>
        ${ex.video ? `
          <button class="btn btn-secondary btn-small" onclick="app.playVideo('${ex.name}', '${ex.video}')" style="padding: 2px 6px; font-size:11px; display:inline-flex; align-items:center; gap:2px; flex-shrink:0;">
            <i data-lucide="video" style="width:12px; height:12px;"></i> Video
          </button>
        ` : ''}
      `;
      mobilityList.appendChild(div);
    });
    const checkMobility = document.getElementById('check-mobility-done');
    checkMobility.checked = !!this.state.completedSteps[todayStr]['step-mobility'];
    this.completeStepVisual('step-mobility', checkMobility.checked);

    // Setup Aproximación / Activación
    const stepApprox = document.getElementById('step-approximation');
    if (dayData.hasApproximation) {
      stepApprox.style.display = 'block';
      document.getElementById('approx-text').innerText = dayData.approximationInfo;
      const checkApprox = document.getElementById('check-approx-done');
      checkApprox.checked = !!this.state.completedSteps[todayStr]['step-approximation'];
      this.completeStepVisual('step-approximation', checkApprox.checked);
      // Activation video button
      const btnActivVideo = document.getElementById('btn-activation-video');
      if (btnActivVideo) {
        if (dayData.activationVideo) {
          btnActivVideo.style.display = 'inline-flex';
          btnActivVideo.onclick = () => this.playVideo('Activación / Aproximación', dayData.activationVideo);
        } else {
          btnActivVideo.style.display = 'none';
        }
      }
    } else {
      stepApprox.style.display = 'none';
    }

    // Setup Pesas (Ejercicios principales)
    const pesasList = document.getElementById('pesas-exercises-list');
    pesasList.innerHTML = '';
    
    // Initialize temporary active logs for exercises of this day
    if (!this.state.currentWorkoutLogs[dayId]) {
      this.state.currentWorkoutLogs[dayId] = {};
    }

    dayData.exercises.forEach(ex => {
      // Ensure logs state for this exercise exists
      if (!this.state.currentWorkoutLogs[dayId][ex.id]) {
        this.state.currentWorkoutLogs[dayId][ex.id] = Array.from({ length: ex.sets }, () => ({
          weight: '',
          reps: '',
          done: false
        }));
      }

      const exerciseCard = document.createElement('div');
      exerciseCard.className = 'exercise-log-card';
      
      let tableRows = '';
      const setLogs = this.state.currentWorkoutLogs[dayId][ex.id];
      
      for (let i = 0; i < ex.sets; i++) {
        const setLog = setLogs[i] || { weight: '', reps: '', done: false };
        const activeClass = setLog.done ? 'active' : '';
        tableRows += `
          <tr>
            <td><span class="set-num-badge">${i + 1}</span></td>
            <td>
              <input type="number" step="0.5" class="log-input" placeholder="--" 
                value="${setLog.weight}" 
                onchange="app.logSetDetails('${ex.id}', ${i}, 'weight', this.value)" 
                ${setLog.done ? 'disabled' : ''} />
            </td>
            <td>
              <input type="number" class="log-input" placeholder="--" 
                value="${setLog.reps}" 
                onchange="app.logSetDetails('${ex.id}', ${i}, 'reps', this.value)" 
                ${setLog.done ? 'disabled' : ''} />
            </td>
            <td>
              <button class="btn-check-set ${activeClass}" onclick="app.toggleSetCheck('${ex.id}', ${i}, ${ex.rest}, ${ex.unilateral})">
                <i data-lucide="check" style="width: 14px; height: 14px;"></i>
              </button>
            </td>
          </tr>
        `;
      }

      // Read technical advice or check for double overload advice to display
      const adviceHtml = this.checkOverloadAdvancement(ex, setLogs);

      exerciseCard.innerHTML = `
        <div class="exercise-header-row">
          <h4 style="font-size: 15px; font-weight: 700; color: var(--text-primary);">${ex.name}</h4>
          <div style="display:flex; gap: 8px;">
            ${ex.video ? `
              <button class="btn btn-secondary btn-small" style="padding: 4px 8px;" onclick="app.playVideo('${ex.name}', '${ex.video}')">
                <i data-lucide="video" style="width: 12px; height: 12px;"></i> Video
              </button>
            ` : ''}
            <span style="font-size: 11px; color: var(--color-rose); font-weight: 600; padding: 4px 8px; background: rgba(244, 63, 94, 0.08); border-radius: 6px;">
              ${ex.sets}x${ex.repsRange}
            </span>
          </div>
        </div>
        <div class="exercise-keys-note">${ex.keys || 'Mantén técnica controlada.'}</div>
        <table class="set-log-table">
          <thead>
            <tr>
              <th>Serie</th>
              <th>Peso (kg)</th>
              <th>Reps</th>
              <th>Listo</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
        <div id="overload-box-${ex.id}">
          ${adviceHtml}
        </div>
      `;
      pesasList.appendChild(exerciseCard);
    });

    const checkPesas = document.getElementById('check-pesas-done');
    checkPesas.checked = !!this.state.completedSteps[todayStr]['step-pesas'];
    this.completeStepVisual('step-pesas', checkPesas.checked);

    // Setup Cardio
    const cardioContent = document.getElementById('cardio-content-area');
    const isCardioCompleted = !!this.state.completedSteps[todayStr]['step-cardio'];
    if (dayData.cardio && dayData.cardioInfo) {
      document.getElementById('cardio-subtitle').innerText = `${dayData.cardioInfo.duration} • ${dayData.cardioInfo.type}`;
      cardioContent.innerHTML = `
        <p style="font-size: 13px; margin-bottom: 12px; color: var(--text-secondary);">
          <strong style="color: var(--text-primary);">Intensidad:</strong> ${dayData.cardioInfo.intensity}. Mantenlo controlado.<br/>
          <em>El cardio es para salud y cintura controlada, no para quemarte.</em>
        </p>
        <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 12px;">
          <button class="btn btn-lavender btn-small btn-cardio-start" style="flex:1;" onclick="app.startCardioTimer('${dayData.cardioInfo.duration}')">
            ▶ Iniciar Cardio (${dayData.cardioInfo.duration})
          </button>
          ${dayData.cardioInfo.video ? `
            <button class="btn btn-secondary btn-small" onclick="app.playVideo('Cardio', '${dayData.cardioInfo.video}')" style="padding: 6px 8px; display:inline-flex; align-items:center; gap:4px;">
              <i data-lucide="video" style="width: 14px; height: 14px;"></i> Video
            </button>
          ` : ''}
        </div>
        <label class="check-item">
          <input type="checkbox" id="check-cardio-done" ${isCardioCompleted ? 'checked' : ''} onchange="app.completeStep('step-cardio', this.checked)" />
          <div class="custom-checkbox"></div>
          <span style="font-weight: 500;">Cardio completado</span>
        </label>
      `;
      this.completeStepVisual('step-cardio', isCardioCompleted);
    } else {
      document.getElementById('cardio-subtitle').innerText = 'Hoy no toca cardio formal';
      cardioContent.innerHTML = `
        <p style="font-size: 13px; margin-bottom: 8px; color: var(--text-secondary);">¡Día libre de cardio! Enfócate al 100% en la fuerza y glúteos. 💪</p>
        <label class="check-item">
          <input type="checkbox" id="check-cardio-done" ${isCardioCompleted ? 'checked' : ''} onchange="app.completeStep('step-cardio', this.checked)" />
          <div class="custom-checkbox"></div>
          <span style="font-weight: 500;">Sin cardio hoy — marcar</span>
        </label>
      `;
      this.completeStepVisual('step-cardio', isCardioCompleted);
    }

    // Cooldown Walk Setup
    const checkCooldown = document.getElementById('check-cooldown-done');
    checkCooldown.checked = !!this.state.completedSteps[todayStr]['step-cooldown'];
    this.completeStepVisual('step-cooldown', checkCooldown.checked);
    
    const btnCooldownVideo = document.getElementById('btn-cooldown-video');
    if (btnCooldownVideo) {
      if (dayData.cooldown.walkVideo) {
        btnCooldownVideo.style.display = 'inline-flex';
        btnCooldownVideo.onclick = () => this.playVideo('Vuelta a la Calma', dayData.cooldown.walkVideo);
      } else {
        btnCooldownVideo.style.display = 'none';
      }
    }
    const coolText = document.getElementById('cooldown-text-desc');
    if (coolText && dayData.cooldown.walk) {
      coolText.innerText = dayData.cooldown.walk;
    }

    // Stretching Setup
    const checkStretching = document.getElementById('check-stretching-done');
    checkStretching.checked = !!this.state.completedSteps[todayStr]['step-stretching'];
    this.completeStepVisual('step-stretching', checkStretching.checked);
    document.getElementById('stretching-desc').innerText = dayData.cooldown.stretching || 'Estira suavemente.';
    
    const btnStretchingVideo = document.getElementById('btn-stretching-video');
    if (btnStretchingVideo) {
      if (dayData.cooldown.stretchingVideo) {
        btnStretchingVideo.style.display = 'inline-flex';
        btnStretchingVideo.onclick = () => this.playVideo('Estiramiento Suave', dayData.cooldown.stretchingVideo);
      } else {
        btnStretchingVideo.style.display = 'none';
      }
    }

    // Hipopresivos Setup
    const checkHipopresivos = document.getElementById('check-hipopresivos-done');
    checkHipopresivos.checked = !!this.state.completedSteps[todayStr]['step-hipopresivos'];
    this.completeStepVisual('step-hipopresivos', checkHipopresivos.checked);
    
    const defaultHipoTime = this.state.routine.hipopresivosDefaults[dayId] || "8–10 min";
    document.getElementById('hipopresivos-subtitle').innerText = `${defaultHipoTime} • Hipopresivos Diarios`;
    
    const btnHipopresivosVideo = document.getElementById('btn-hipopresivos-video');
    if (btnHipopresivosVideo) {
      if (dayData.cooldown.vacuumVideo) {
        btnHipopresivosVideo.style.display = 'inline-flex';
        btnHipopresivosVideo.onclick = () => this.playVideo('Hipopresivos Diarios', dayData.cooldown.vacuumVideo);
      } else {
        btnHipopresivosVideo.style.display = 'none';
      }
    }

    // Sync Independent Hipopresivos Card
    const checkHipoIndependent = document.getElementById('check-hipo-independent-done');
    if (checkHipoIndependent) {
      checkHipoIndependent.checked = !!this.state.completedSteps[todayStr]['step-hipopresivos'];
    }
    const hipoIndependentDuration = document.getElementById('hipo-independent-duration');
    if (hipoIndependentDuration) {
      hipoIndependentDuration.innerText = `Duración de hoy: ${defaultHipoTime} (Recomendado en ayunas o antes de dormir)`;
    }

  }

  toggleIndependentHipo(isChecked) {
    const todayStr = this.getTodayDateString();
    this.saveCheckState('step-hipopresivos', isChecked);
    
    // Sync accordion checkbox
    const accCheck = document.getElementById('check-hipopresivos-done');
    if (accCheck) accCheck.checked = isChecked;
    this.completeStepVisual('step-hipopresivos', isChecked);
  }

  playHipoVideo() {
    const dayId = this.state.activeDay;
    const dayData = this.state.routine.days.find(d => d.id === dayId);
    const videoUrl = (dayData && dayData.cooldown && dayData.cooldown.vacuumVideo) || 'https://www.youtube.com/watch?v=rep-q_aO1Yg';
    this.playVideo('Hipopresivos Diarios', videoUrl);
  }

  startIndependentHipoTimer() {
    const dayId = this.state.activeDay;
    const routineDay = this.state.routine.days.find(d => d.id === dayId);
    let duration = 600; // 10 min
    if (routineDay) {
      const durationStr = this.state.routine.hipopresivosDefaults[dayId] || "10 min";
      const match = durationStr.match(/(\d+)/);
      if (match) duration = parseInt(match[1]) * 60;
    }
    this.startTimer(duration, false, "Hipopresivos Diarios", "hipopresivos");
  }

  // ACCORDIONS AND GENERAL STEPS PROGRESS
  toggleFlowStep(stepId) {
    const el = document.getElementById(stepId);
    if (!el) return;
    el.classList.toggle('open');
  }

  saveCheckState(checkKey, isChecked) {
    const todayStr = this.getTodayDateString();
    if (!this.state.completedSteps[todayStr]) this.state.completedSteps[todayStr] = {};
    this.state.completedSteps[todayStr][checkKey] = isChecked;
    this.saveState();
  }

  completeStep(stepId, isChecked) {
    this.saveCheckState(stepId, isChecked);
    this.completeStepVisual(stepId, isChecked);
  }

  completeStepVisual(stepId, isChecked) {
    const el = document.getElementById(stepId);
    if (!el) return;

    if (isChecked) {
      el.classList.add('completed');
      el.classList.remove('active');
    } else {
      el.classList.remove('completed');
      el.classList.remove('active');
    }
  }

  logSetDetails(exId, setIndex, field, value) {
    const dayId = this.state.activeDay;
    if (value === '') return;
    
    this.state.currentWorkoutLogs[dayId][exId][setIndex][field] = parseFloat(value) || value;
    this.saveState();
  }

  toggleSetCheck(exId, setIndex, restSeconds, isUnilateral) {
    const dayId = this.state.activeDay;
    const setLog = this.state.currentWorkoutLogs[dayId][exId][setIndex];
    
    // Ensure they entered values before completing
    if (setLog.weight === '' || setLog.reps === '') {
      alert("Por favor ingresa el Peso y las Repeticiones antes de marcar la serie como completada.");
      return;
    }

    setLog.done = !setLog.done;
    this.saveState();

    // Re-render workout list to block inputs and change color
    this.renderWorkoutFlow();

    // Start Rest Timer if the set is marked done
    if (setLog.done) {
      this.timerTarget = restSeconds;
      this.startTimer(restSeconds, isUnilateral);
    }
  }

  // DOUBLE OVERLOAD CRITERIA ANALYSIS
  checkOverloadAdvancement(ex, setLogs) {
    // Check if all sets are marked as completed
    const allDone = setLogs.every(s => s.done);
    if (!allDone) return '';

    // Check reps range
    let upperLimit = 12; // default
    if (ex.repsRange.includes('–')) {
      const parts = ex.repsRange.split('–');
      upperLimit = parseInt(parts[1]) || 12;
    } else if (ex.repsRange.includes('-')) {
      const parts = ex.repsRange.split('-');
      upperLimit = parseInt(parts[1]) || 12;
    } else {
      upperLimit = parseInt(ex.repsRange) || 12;
    }

    // Check if every completed set reached or exceeded the upper limit
    const achievedOverload = setLogs.every(s => parseInt(s.reps) >= upperLimit);

    if (achievedOverload) {
      if (ex.type === 'heavy') {
        return `
          <div class="overload-advice">
            <i data-lucide="award" style="width: 16px; height: 16px; color: var(--color-cyan); flex-shrink: 0; margin-top: 2px;"></i>
            <span><strong>¡SOBRECARGA COMPLETADA!</strong> Lograste hacer ${upperLimit} reps en todas las series. Sube de peso la próxima semana (+2.5kg o +5kg) y baja a 8 repeticiones.</span>
          </div>
        `;
      } else {
        return `
          <div class="overload-advice" style="border-color: rgba(168, 85, 247, 0.4); background: linear-gradient(135deg, rgba(168, 85, 247, 0.15), rgba(20,27,45,0.6));">
            <i data-lucide="sparkles" style="width: 16px; height: 16px; color: var(--color-violet); flex-shrink: 0; margin-top: 2px;"></i>
            <span><strong>¡PROGRESIÓN TÉCNICA!</strong> Alcanzaste las ${upperLimit} repeticiones. Sube un nivel de carga/placa o concéntrate en una bajada aún más lenta.</span>
          </div>
        `;
      }
    }

    return '';
  }

  // REST TIMER CORE
  startTimer(seconds, isUnilateral, title = "Descanso", autoCheckStepId = null) {
    // Clear previous timer
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.timerRemaining = seconds;
    this.timerTarget = seconds;
    this.isTimerPaused = false;
    this.autoCheckStepId = autoCheckStepId;

    // Show Rest Timer floating drawer
    const drawer = document.getElementById('floating-timer');
    const appWrapper = document.getElementById('app-wrapper');
    if (drawer) drawer.classList.add('show');
    if (appWrapper) appWrapper.classList.add('timer-active');

    // Set title
    const titleEl = document.getElementById('timer-title-text');
    if (titleEl) {
      titleEl.innerHTML = `<i data-lucide="timer" style="width: 16px; height: 16px;"></i> ${title}`;
      lucide.createIcons();
    }

    // Unilateral UI states
    const unilateralSection = document.getElementById('timer-unilateral-section');
    const unilateralCheckbox = document.getElementById('timer-unilateral-checkbox');
    
    if (isUnilateral && unilateralSection) {
      unilateralSection.style.display = 'flex';
      unilateralCheckbox.checked = isUnilateral;
      this.toggleUnilateralRestVisual(isUnilateral, seconds);
    } else if (unilateralSection) {
      unilateralSection.style.display = 'none';
    }

    this.updateTimerDisplay();

    this.timerInterval = setInterval(() => {
      if (!this.isTimerPaused) {
        this.timerRemaining--;
        this.updateTimerDisplay();

        if (this.timerRemaining <= 0) {
          clearInterval(this.timerInterval);
          this.playBeep();
          this.closeTimer();
          
          if (this.autoCheckStepId) {
            const checkEl = document.getElementById(`check-${this.autoCheckStepId}-done`);
            if (checkEl) {
              checkEl.checked = true;
              this.completeStep(this.autoCheckStepId, true);
            }
            if (this.autoCheckStepId === 'hipopresivos') {
              const indCheck = document.getElementById('check-hipo-independent-done');
              if (indCheck) indCheck.checked = true;
            }
          }
        }
      }
    }, 1000);
  }

  toggleTimerPause() {
    this.isTimerPaused = !this.isTimerPaused;
    const btn = document.getElementById('btn-timer-pause');
    if (btn) {
      btn.innerText = this.isTimerPaused ? "Reanudar" : "Pausar";
    }
  }

  addTimerTime(seconds) {
    this.timerRemaining = Math.max(5, this.timerRemaining + seconds);
    this.updateTimerDisplay();
  }

  resetTimer() {
    this.timerRemaining = this.timerTarget;
    this.updateTimerDisplay();
  }

  closeTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    const drawer = document.getElementById('floating-timer');
    const appWrapper = document.getElementById('app-wrapper');
    if (drawer) drawer.classList.remove('show');
    if (appWrapper) appWrapper.classList.remove('timer-active');
  }

  updateTimerDisplay() {
    const mins = Math.floor(this.timerRemaining / 60);
    const secs = this.timerRemaining % 60;
    const display = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    document.getElementById('timer-digits').innerText = display;
  }

  toggleUnilateralRest(isChecked) {
    if (isChecked) {
      // Shorter unilateral switch rest (default 30 seconds for swapping sides)
      this.timerTarget = 30;
      this.timerRemaining = 30;
    } else {
      // Restore standard rest target
      const dayId = this.state.activeDay;
      this.timerTarget = 90; // fallback standard rest
      this.timerRemaining = 90;
    }
    this.updateTimerDisplay();
  }

  toggleUnilateralRestVisual(isUnilateral, fullRest) {
    const label = document.getElementById('unilateral-label');
    if (label) {
      label.innerText = isUnilateral 
        ? `Completo era: ${fullRest}s` 
        : `Completo: ${fullRest}s`;
    }
  }

  playBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      
      // Triple beep
      const times = [0, 0.4, 0.8];
      times.forEach(t => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime + t); // A5 frequency
        gain.gain.setValueAtTime(0.2, ctx.currentTime + t);
        osc.start(ctx.currentTime + t);
        osc.stop(ctx.currentTime + t + 0.25);
      });
    } catch (e) {
      console.warn("AudioContext block by browser auto-play policy.", e);
    }
  }

  // PHASE TIMERS (WARMUP / COOLDOWN / CARDIO / HIPOPRESIVOS)
  startPhaseTimer(type, durationSeconds, btnEl) {
    if (btnEl.dataset.running === "true") {
      // Pause/Cancel
      clearInterval(this[`active${this.capitalize(type)}Timer`]);
      btnEl.dataset.running = "false";
      btnEl.innerHTML = `<i data-lucide="play" style="width: 14px; height: 14px;"></i> Iniciar`;
      lucide.createIcons();
      return;
    }

    btnEl.dataset.running = "true";
    let timeLeft = durationSeconds;

    const tick = () => {
      timeLeft--;
      const mins = Math.floor(timeLeft / 60);
      const secs = timeLeft % 60;
      btnEl.innerHTML = `<i data-lucide="square" style="width: 14px; height: 14px;"></i> ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      
      if (timeLeft <= 0) {
        clearInterval(this[`active${this.capitalize(type)}Timer`]);
        btnEl.dataset.running = "false";
        btnEl.innerHTML = `<i data-lucide="check" style="width: 14px; height: 14px;"></i> Terminado`;
        this.playBeep();
        
        // Auto-check the step
        const checkEl = document.getElementById(`check-${type}-done`);
        if (checkEl) {
          checkEl.checked = true;
          this.completeStep(`step-${type}`, true);
        }
      }
    };

    tick();
    this[`active${this.capitalize(type)}Timer`] = setInterval(tick, 1000);
    lucide.createIcons();
  }

  startCardioTimer(durationStr) {
    const match = durationStr.match(/(\d+)/);
    const durationMins = match ? parseInt(match[1]) : 20;
    const durationSecs = durationMins * 60;

    // Show a floating timer for cardio
    this.timerTarget = durationSecs;
    this.startTimer(durationSecs, false);

    // Also visually update the cardio button if it exists
    const btnCardio = document.querySelector('.btn-cardio-start');
    if (btnCardio) {
      btnCardio.disabled = true;
      btnCardio.innerText = `⏱ ${durationMins} min corriendo...`;
    }
  }

  // END WORKOUT
  completeFullWorkout() {
    const todayStr = this.getTodayDateString();
    const dayId = this.state.activeDay;

    // Check if they completed at least pesas
    const todaySteps = this.state.completedSteps[todayStr] || {};
    if (!todaySteps['step-pesas']) {
      const confirmEnd = confirm("Aún no has completado la fase principal de pesas. ¿Estás segura de que quieres finalizar el entrenamiento hoy?");
      if (!confirmEnd) return;
    }

    // Save logs of completed exercises into permanent weights history
    const dayData = this.state.routine.days.find(d => d.id === dayId);
    if (dayData) {
      dayData.exercises.forEach(ex => {
        const sets = this.state.currentWorkoutLogs[dayId][ex.id];
        const hasCompletedSets = sets && sets.some(s => s.done);

        if (hasCompletedSets) {
          // Push to logs history
          this.state.weightsHistory.push({
            exerciseId: ex.id,
            exerciseName: ex.name,
            date: todayStr,
            sets: JSON.parse(JSON.stringify(sets)) // clone
          });
        }
      });
    }

    // Clear active current logs for this day so it can start fresh next time
    this.state.currentWorkoutLogs[dayId] = {};

    // Push completion log
    this.state.logs.push({
      date: todayStr,
      dayId: dayId,
      completed: true
    });

    this.saveState();

    // Trigger visual confetti celebration
    this.celebrateWorkoutCompletion();

    // Re-render
    this.renderWorkoutFlow();
  }

  celebrateWorkoutCompletion() {
    const overlay = document.getElementById('celebration-overlay');
    overlay.innerHTML = '';
    
    // Create confetti particles
    const colors = ['#f43f5e', '#a855f7', '#06b6d4', '#10b981', '#f59e0b'];
    for (let i = 0; i < 60; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-particle';
      p.style.left = Math.random() * 100 + 'vw';
      p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      p.style.animationDelay = Math.random() * 2 + 's';
      p.style.transform = `scale(${Math.random() * 0.8 + 0.4})`;
      overlay.appendChild(p);
    }

    setTimeout(() => {
      overlay.innerHTML = '';
      alert("🏆 ¡Entrenamiento completado y guardado con éxito! Increíble trabajo hoy.");
    }, 3200);
  }

  // INLINE VIDEO modal
  playVideo(name, url) {
    const modal = document.getElementById('video-modal');
    const title = document.getElementById('video-modal-title');
    const container = document.getElementById('video-modal-player-container');

    title.innerText = `Técnica: ${name}`;

    // Convert standard YouTube watch link to embed link
    let embedUrl = url;
    if (url.includes('youtube.com/watch?v=')) {
      const videoId = url.split('v=')[1]?.split('&')[0];
      embedUrl = `https://www.youtube.com/embed/${videoId}`;
    } else if (url.includes('youtu.be/')) {
      const videoId = url.split('youtu.be/')[1]?.split('?')[0];
      embedUrl = `https://www.youtube.com/embed/${videoId}`;
    }

    if (embedUrl.includes('youtube.com/embed/')) {
      container.innerHTML = `
        <iframe class="video-container-iframe" src="${embedUrl}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
      `;
    } else {
      // Generic web MP4 player
      container.innerHTML = `
        <video class="video-container-iframe" controls autoplay>
          <source src="${url}" type="video/mp4">
          Tu navegador no soporta reproducción de video.
        </video>
      `;
    }

    modal.classList.add('active');
  }

  closeVideoModal() {
    const modal = document.getElementById('video-modal');
    const container = document.getElementById('video-modal-player-container');
    modal.classList.remove('active');
    container.innerHTML = ''; // stops playback
  }

  // RENDER ROUTINE EDITOR (TAB ROUTINES)
  renderRoutineEditor() {
    const container = document.getElementById('routine-days-container');
    if (!container) return;

    container.innerHTML = '';

    this.state.routine.days.forEach(day => {
      const dayCard = document.createElement('div');
      dayCard.className = 'card routine-day-card';
      
      // 1. Warmup details
      const warmupOptionTags = (day.warmup.options || []).map(opt => `<span style="background:rgba(255,255,255,0.03); padding:2px 6px; border-radius:4px; font-size:11px; margin-right:4px; display:inline-block; margin-top:2px;">${opt}</span>`).join(' ');
      const warmupHtml = `
        <div style="background: rgba(255,255,255,0.02); padding: 10px; border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--border-glass);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <strong style="font-size:13px; color:var(--text-primary);">1. Calentamiento</strong>
            <button class="btn btn-secondary btn-small" onclick="app.openWarmupEdit('${day.id}')" style="padding: 2px 6px; font-size:11px;">Editar</button>
          </div>
          <div style="font-size:12px; color:var(--text-secondary); display: flex; flex-direction: column; gap: 4px;">
            <div><strong>Duración:</strong> ${day.warmup.duration}</div>
            <div><strong>Descripción:</strong> ${day.warmup.description}</div>
            <div><strong>Opciones:</strong> ${warmupOptionTags || '--'}</div>
            ${day.warmup.video ? `<div style="margin-top:2px; font-size:11px; color:var(--color-rose); display:flex; align-items:center; gap:4px;"><i data-lucide="video" style="width:10px; height:10px;"></i> Video tutorial configurado</div>` : ''}
          </div>
        </div>
      `;

      // 2. Mobility details
      const totalMob = (day.mobility.exercises || []).length;
      let mobilityRows = '';
      (day.mobility.exercises || []).forEach((mob, idx) => {
        mobilityRows += `
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.03); padding: 6px 0;">
            <div style="font-size:12px; max-width: 55%;">
              <strong>${mob.name}</strong> (${mob.reps})
              ${mob.video ? `<div style="font-size:10px; color:var(--color-rose); margin-top:2px; display:flex; align-items:center; gap:4px;"><i data-lucide="video" style="width:9px; height:9px;"></i> Video listo</div>` : ''}
            </div>
            <div style="display:flex; gap:4px; align-items:center; flex-shrink:0;">
              <button class="btn btn-secondary btn-small" onclick="app.moveMobilityExercise('${day.id}', ${idx}, -1)" style="padding: 2px 5px; font-size:11px;" ${idx === 0 ? 'disabled' : ''}>↑</button>
              <button class="btn btn-secondary btn-small" onclick="app.moveMobilityExercise('${day.id}', ${idx}, 1)" style="padding: 2px 5px; font-size:11px;" ${idx === totalMob - 1 ? 'disabled' : ''}>↓</button>
              <button class="btn btn-secondary btn-small" onclick="app.openMobilityEdit('${day.id}', ${idx})" style="padding: 2px 6px; font-size:11px;">Editar</button>
            </div>
          </div>
        `;
      });
      const mobilityHtml = `
        <div style="background: rgba(255,255,255,0.02); padding: 10px; border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--border-glass);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <strong style="font-size:13px; color:var(--text-primary);">2. Movilidad (${day.mobility.rounds} rondas)</strong>
            <button class="btn btn-secondary btn-small" onclick="app.openMobilityAdd('${day.id}')" style="padding: 2px 6px; font-size:11px;">+ Agregar</button>
          </div>
          <div style="display:flex; flex-direction:column;">
            ${mobilityRows || '<p style="font-size:11px; color:var(--text-muted); margin:0;">Sin ejercicios de movilidad.</p>'}
          </div>
        </div>
      `;

      // 3. Central Exercises details
      const totalEx = day.exercises.length;
      let exercisesHtml = '';
      day.exercises.forEach((ex, exIdx) => {
        exercisesHtml += `
          <div class="routine-exercise-item" style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.03); display: flex; justify-content: space-between; align-items: center;">
            <div style="max-width:55%;">
              <div style="font-weight:600; font-size:13px;">${ex.name}</div>
              <div style="font-size:11px; color: var(--text-secondary); margin-top:2px;">
                ${ex.sets} series x ${ex.repsRange} reps • ${ex.rest}s descanso
                ${ex.video ? `<br/><span style="color:var(--color-rose); font-size:10px; display:inline-flex; align-items:center; gap:4px;"><i data-lucide="video" style="width:9px; height:9px;"></i> Video listo</span>` : ''}
              </div>
            </div>
            <div style="display:flex; gap:4px; align-items:center; flex-shrink:0;">
              <button class="btn btn-secondary btn-small" onclick="app.moveExercise('${day.id}', ${exIdx}, -1)" style="padding: 2px 5px; font-size:11px;" ${exIdx === 0 ? 'disabled' : ''}>↑</button>
              <button class="btn btn-secondary btn-small" onclick="app.moveExercise('${day.id}', ${exIdx}, 1)" style="padding: 2px 5px; font-size:11px;" ${exIdx === totalEx - 1 ? 'disabled' : ''}>↓</button>
              <button class="btn btn-secondary btn-small" onclick="app.openEditModal('${day.id}', '${ex.id}')" style="padding: 2px 6px; font-size:11px;">Editar</button>
            </div>
          </div>
        `;
      });
      const exercisesSectionHtml = `
        <div style="background: rgba(255,255,255,0.02); padding: 10px; border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--border-glass);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:6px;">
            <strong style="font-size:13px; color:var(--text-primary);">3. Ejercicios Principales</strong>
            <button class="btn btn-secondary btn-small" onclick="app.openAddExerciseModal('${day.id}')" style="padding: 2px 6px; font-size:11px;">+ Agregar</button>
          </div>
          <div style="display:flex; flex-direction:column;">
            ${exercisesHtml || '<p style="font-size:11px; color:var(--text-muted); margin:0;">Sin ejercicios principales.</p>'}
          </div>
        </div>
      `;

      // 4. Activation / approximation details
      const activationHtml = `
        <div style="background: rgba(255,255,255,0.02); padding: 10px; border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--border-glass);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <strong style="font-size:13px; color:var(--text-primary);">3a. Activación / Aproximación</strong>
            <button class="btn btn-secondary btn-small" onclick="app.openActivationEdit('${day.id}')" style="padding: 2px 6px; font-size:11px;">Editar</button>
          </div>
          <div style="font-size:12px; color:var(--text-secondary); display:flex; flex-direction:column; gap:4px;">
            <div><strong>¿Activa?:</strong> ${day.hasApproximation ? 'Sí' : 'No'}</div>
            ${day.hasApproximation ? `<div style="font-size:11px; color:var(--text-muted); max-width:100%;">${day.approximationInfo || '--'}</div>` : ''}
            ${day.activationVideo ? `<div style="font-size:11px; color:var(--color-rose); display:flex; align-items:center; gap:4px;"><i data-lucide="video" style="width:9px; height:9px;"></i> Video listo</div>` : ''}
          </div>
        </div>
      `;

      // 5. Cardio details
      const cardioHtml = `
        <div style="background: rgba(255,255,255,0.02); padding: 10px; border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--border-glass);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <strong style="font-size:13px; color:var(--text-primary);">5. Cardio</strong>
            <button class="btn btn-secondary btn-small" onclick="app.openCardioEdit('${day.id}')" style="padding: 2px 6px; font-size:11px;">Editar</button>
          </div>
          <div style="font-size:12px; color:var(--text-secondary); display: flex; flex-direction: column; gap: 4px;">
            <div><strong>¿Tiene cardio?:</strong> ${day.cardio ? 'Sí' : 'No'}</div>
            ${day.cardio && day.cardioInfo ? `
              <div><strong>Duración:</strong> ${day.cardioInfo.duration}</div>
              <div><strong>Tipo:</strong> ${day.cardioInfo.type}</div>
              <div><strong>Intensidad:</strong> ${day.cardioInfo.intensity}</div>
              ${day.cardioInfo.video ? `<div style="margin-top:2px; font-size:11px; color:var(--color-rose); display:flex; align-items:center; gap:4px;"><i data-lucide="video" style="width:10px; height:10px;"></i> Video tutorial listo</div>` : ''}
            ` : ''}
          </div>
        </div>
      `;

      // 6. Cooldown details
      const cooldownHtml = `
        <div style="background: rgba(255,255,255,0.02); padding: 10px; border-radius: 8px; border: 1px solid var(--border-glass);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <strong style="font-size:13px; color:var(--text-primary);">6. Vuelta a la Calma + Hipopresivos</strong>
            <button class="btn btn-secondary btn-small" onclick="app.openCooldownEdit('${day.id}')" style="padding: 2px 6px; font-size:11px;">Editar</button>
          </div>
          <div style="font-size:12px; color:var(--text-secondary); display:flex; flex-direction:column; gap:4px;">
            <div><strong>Caminata:</strong> ${day.cooldown.walk || 'Opcional'} ${day.cooldown.walkVideo ? '<span style="color:var(--color-rose); font-size:10px;">(Video)</span>' : ''}</div>
            <div><strong>Estiramiento:</strong> ${day.cooldown.stretching || 'Opcional'} ${day.cooldown.stretchingVideo ? '<span style="color:var(--color-rose); font-size:10px;">(Video)</span>' : ''}</div>
            <div><strong>Hipopresivos (Vacuum):</strong> ${day.cooldown.stomachVacuum || 'Opcional'} ${day.cooldown.vacuumVideo ? '<span style="color:var(--color-rose); font-size:10px;">(Video)</span>' : ''}</div>
          </div>
        </div>
      `;

      // Section Order controls (display sorted by day.sectionOrder or default)
      const defaultSectionOrder = ['warmup', 'mobility', 'activation', 'pesas', 'cardio', 'cooldown'];
      const sectionOrder = day.sectionOrder || defaultSectionOrder;
      const sectionMap = { warmup: warmupHtml, mobility: mobilityHtml, activation: activationHtml, pesas: exercisesSectionHtml, cardio: cardioHtml, cooldown: cooldownHtml };
      const sectionLabels = { warmup: 'Calentamiento', mobility: 'Movilidad', activation: 'Activación', pesas: 'Ejercicios Principales', cardio: 'Cardio', cooldown: 'Vuelta a la Calma' };
      
      let orderedSectionsHtml = '';
      sectionOrder.forEach((secId, secIdx) => {
        orderedSectionsHtml += `
          <div style="position:relative;">
            <div style="position:absolute; top:8px; right:8px; display:flex; gap:4px; z-index:2;">
              <button class="btn btn-secondary btn-small" onclick="app.moveSection('${day.id}', '${secId}', -1)" style="padding: 1px 4px; font-size:10px; opacity:0.7;" ${secIdx === 0 ? 'disabled' : ''}>↑</button>
              <button class="btn btn-secondary btn-small" onclick="app.moveSection('${day.id}', '${secId}', 1)" style="padding: 1px 4px; font-size:10px; opacity:0.7;" ${secIdx === sectionOrder.length - 1 ? 'disabled' : ''}>↓</button>
            </div>
            ${sectionMap[secId] || ''}
          </div>
        `;
      });

      dayCard.innerHTML = `
        <div class="routine-day-header" onclick="app.toggleRoutineDayCollapse('${day.id}')">
          <div>
            <h3 style="font-size:16px; font-weight:700; color: var(--color-rose);">${day.name}</h3>
            <span style="font-size:12px; color:var(--text-secondary);">${day.focus}</span>
          </div>
          <i data-lucide="chevron-down" id="arrow-${day.id}"></i>
        </div>
        <div id="exercises-editor-${day.id}" style="margin-top: 14px; display: none;">
          <p style="font-size:11px; color:var(--text-muted); margin-bottom:10px; padding: 6px 10px; background:rgba(168,85,247,0.06); border-radius:6px;">
            💡 Usa las flechas ↑↓ en cada sección para cambiar el orden del entrenamiento de hoy
          </p>
          ${orderedSectionsHtml}
        </div>
      `;
      container.appendChild(dayCard);
    });

    lucide.createIcons();
  }

  toggleRoutineDayCollapse(dayId) {
    const block = document.getElementById(`exercises-editor-${dayId}`);
    const arrow = document.getElementById(`arrow-${dayId}`);
    if (block.style.display === 'none') {
      block.style.display = 'block';
      arrow.style.transform = 'rotate(180deg)';
    } else {
      block.style.display = 'none';
      arrow.style.transform = 'rotate(0deg)';
    }
  }

  // EXERCISE EDIT MODAL
  openEditModal(dayId, exId) {
    this.editingDayId = dayId;
    this.editingExId = exId;
    this.isAddingExercise = false;

    const day = this.state.routine.days.find(d => d.id === dayId);
    const ex = day.exercises.find(e => e.id === exId);

    document.getElementById('edit-ex-name').value = ex.name;
    document.getElementById('edit-ex-sets').value = ex.sets;
    document.getElementById('edit-ex-reps').value = ex.repsRange;
    document.getElementById('edit-ex-rest').value = ex.rest;
    document.getElementById('edit-ex-keys').value = ex.keys || '';
    document.getElementById('edit-ex-video').value = ex.video || '';
    document.getElementById('btn-delete-exercise').style.display = 'block';

    document.getElementById('edit-exercise-modal').classList.add('active');
  }

  openAddExerciseModal(dayId) {
    this.editingDayId = dayId;
    this.editingExId = null;
    this.isAddingExercise = true;

    document.getElementById('edit-ex-name').value = '';
    document.getElementById('edit-ex-sets').value = '3';
    document.getElementById('edit-ex-reps').value = '10–12';
    document.getElementById('edit-ex-rest').value = '90';
    document.getElementById('edit-ex-keys').value = '';
    document.getElementById('edit-ex-video').value = '';
    document.getElementById('btn-delete-exercise').style.display = 'none';

    document.getElementById('edit-exercise-modal').classList.add('active');
  }

  closeEditModal() {
    document.getElementById('edit-exercise-modal').classList.remove('active');
  }

  saveEditedExercise() {
    const day = this.state.routine.days.find(d => d.id === this.editingDayId);
    
    const name = document.getElementById('edit-ex-name').value.trim();
    const sets = parseInt(document.getElementById('edit-ex-sets').value) || 3;
    const repsRange = document.getElementById('edit-ex-reps').value.trim();
    const rest = parseInt(document.getElementById('edit-ex-rest').value) || 90;
    const keys = document.getElementById('edit-ex-keys').value.trim();
    const video = document.getElementById('edit-ex-video').value.trim();

    if (!name) {
      alert("Por favor ingresa un nombre para el ejercicio.");
      return;
    }

    if (this.isAddingExercise) {
      const newId = name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
      day.exercises.push({
        id: newId,
        name,
        sets,
        repsRange,
        rest,
        type: 'heavy',
        unilateral: false,
        keys,
        video
      });
    } else {
      const ex = day.exercises.find(e => e.id === this.editingExId);
      if (ex) {
        ex.name = name;
        ex.sets = sets;
        ex.repsRange = repsRange;
        ex.rest = rest;
        ex.keys = keys;
        ex.video = video;
      }
    }

    this.saveState();
    this.closeEditModal();
    this.renderRoutineEditor();
    this.renderWorkoutFlow();
    alert("Ejercicio guardado correctamente.");
  }

  deleteExercise() {
    if (this.isAddingExercise) return;
    const day = this.state.routine.days.find(d => d.id === this.editingDayId);
    if (day && this.editingExId) {
      day.exercises = day.exercises.filter(e => e.id !== this.editingExId);
      this.saveState();
    }
    this.closeEditModal();
    this.renderRoutineEditor();
    this.renderWorkoutFlow();
    alert("Ejercicio eliminado correctamente.");
  }

  // MOVE EXERCISE UP/DOWN within main exercises list
  moveExercise(dayId, currentIndex, direction) {
    const day = this.state.routine.days.find(d => d.id === dayId);
    if (!day) return;
    const newIndex = currentIndex + direction;
    if (newIndex < 0 || newIndex >= day.exercises.length) return;
    const tmp = day.exercises[currentIndex];
    day.exercises[currentIndex] = day.exercises[newIndex];
    day.exercises[newIndex] = tmp;
    this.saveState();
    this.renderRoutineEditor();
    // re-open the card that was open
    const block = document.getElementById(`exercises-editor-${dayId}`);
    const arrow = document.getElementById(`arrow-${dayId}`);
    if (block) { block.style.display = 'block'; if (arrow) arrow.style.transform = 'rotate(180deg)'; }
  }

  // MOVE MOBILITY EXERCISE UP/DOWN
  moveMobilityExercise(dayId, currentIndex, direction) {
    const day = this.state.routine.days.find(d => d.id === dayId);
    if (!day || !day.mobility || !day.mobility.exercises) return;
    const newIndex = currentIndex + direction;
    if (newIndex < 0 || newIndex >= day.mobility.exercises.length) return;
    const tmp = day.mobility.exercises[currentIndex];
    day.mobility.exercises[currentIndex] = day.mobility.exercises[newIndex];
    day.mobility.exercises[newIndex] = tmp;
    this.saveState();
    this.renderRoutineEditor();
    const block = document.getElementById(`exercises-editor-${dayId}`);
    const arrow = document.getElementById(`arrow-${dayId}`);
    if (block) { block.style.display = 'block'; if (arrow) arrow.style.transform = 'rotate(180deg)'; }
  }

  // MOVE SECTION UP/DOWN within a day
  moveSection(dayId, sectionId, direction) {
    const day = this.state.routine.days.find(d => d.id === dayId);
    if (!day) return;
    const defaultOrder = ['warmup', 'mobility', 'activation', 'pesas', 'cardio', 'cooldown'];
    if (!day.sectionOrder) day.sectionOrder = [...defaultOrder];
    const currentIdx = day.sectionOrder.indexOf(sectionId);
    if (currentIdx === -1) return;
    const newIdx = currentIdx + direction;
    if (newIdx < 0 || newIdx >= day.sectionOrder.length) return;
    const tmp = day.sectionOrder[currentIdx];
    day.sectionOrder[currentIdx] = day.sectionOrder[newIdx];
    day.sectionOrder[newIdx] = tmp;
    this.saveState();
    this.renderRoutineEditor();
    const block = document.getElementById(`exercises-editor-${dayId}`);
    const arrow = document.getElementById(`arrow-${dayId}`);
    if (block) { block.style.display = 'block'; if (arrow) arrow.style.transform = 'rotate(180deg)'; }
  }

  // WARMUP EDITORS
  openWarmupEdit(dayId) {
    this.editingDayId = dayId;
    const day = this.state.routine.days.find(d => d.id === dayId);
    document.getElementById('edit-warmup-duration').value = day.warmup.duration;
    document.getElementById('edit-warmup-description').value = day.warmup.description || '';
    document.getElementById('edit-warmup-options').value = (day.warmup.options || []).join(', ');
    document.getElementById('edit-warmup-video').value = day.warmup.video || '';
    document.getElementById('edit-warmup-modal').classList.add('active');
  }

  closeWarmupModal() {
    document.getElementById('edit-warmup-modal').classList.remove('active');
  }

  saveWarmup() {
    const day = this.state.routine.days.find(d => d.id === this.editingDayId);
    day.warmup.duration = document.getElementById('edit-warmup-duration').value;
    day.warmup.description = document.getElementById('edit-warmup-description').value;
    day.warmup.options = document.getElementById('edit-warmup-options').value.split(',').map(s => s.trim()).filter(Boolean);
    day.warmup.video = document.getElementById('edit-warmup-video').value.trim();
    
    this.saveState();
    this.closeWarmupModal();
    this.renderRoutineEditor();
    this.renderWorkoutFlow();
    alert("Calentamiento guardado correctamente.");
  }

  // MOBILITY EDITORS
  openMobilityEdit(dayId, index) {
    this.editingDayId = dayId;
    this.editingMobilityIndex = index;
    const day = this.state.routine.days.find(d => d.id === dayId);
    const ex = day.mobility.exercises[index];
    
    document.getElementById('mobility-modal-title').innerText = 'Editar Ejercicio de Movilidad';
    document.getElementById('edit-mob-name').value = ex.name;
    document.getElementById('edit-mob-reps').value = ex.reps;
    document.getElementById('edit-mob-video').value = ex.video || '';
    document.getElementById('btn-delete-mobility').style.display = 'block';
    
    document.getElementById('edit-mobility-modal').classList.add('active');
  }

  openMobilityAdd(dayId) {
    this.editingDayId = dayId;
    this.editingMobilityIndex = null;
    
    document.getElementById('mobility-modal-title').innerText = 'Agregar Ejercicio de Movilidad';
    document.getElementById('edit-mob-name').value = '';
    document.getElementById('edit-mob-reps').value = '';
    document.getElementById('edit-mob-video').value = '';
    document.getElementById('btn-delete-mobility').style.display = 'none';
    
    document.getElementById('edit-mobility-modal').classList.add('active');
  }

  closeMobilityModal() {
    document.getElementById('edit-mobility-modal').classList.remove('active');
  }

  saveMobilityExercise() {
    const day = this.state.routine.days.find(d => d.id === this.editingDayId);
    const name = document.getElementById('edit-mob-name').value.trim();
    const reps = document.getElementById('edit-mob-reps').value.trim();
    const video = document.getElementById('edit-mob-video').value.trim();

    if (!name || !reps) {
      alert("Por favor completa el nombre y repeticiones.");
      return;
    }

    if (this.editingMobilityIndex !== null) {
      day.mobility.exercises[this.editingMobilityIndex] = { name, reps, video };
    } else {
      if (!day.mobility.exercises) day.mobility.exercises = [];
      day.mobility.exercises.push({ name, reps, video });
    }

    this.saveState();
    this.closeMobilityModal();
    this.renderRoutineEditor();
    this.renderWorkoutFlow();
    alert("Ejercicio de movilidad guardado correctamente.");
  }

  deleteMobilityExercise() {
    const day = this.state.routine.days.find(d => d.id === this.editingDayId);
    if (this.editingMobilityIndex !== null && day) {
      day.mobility.exercises.splice(this.editingMobilityIndex, 1);
      this.saveState();
    }
    this.closeMobilityModal();
    this.renderRoutineEditor();
    this.renderWorkoutFlow();
    alert("Ejercicio de movilidad eliminado.");
  }

  // CARDIO EDITORS
  openCardioEdit(dayId) {
    this.editingDayId = dayId;
    const day = this.state.routine.days.find(d => d.id === dayId);
    
    document.getElementById('edit-cardio-enabled').checked = !!day.cardio;
    document.getElementById('edit-cardio-duration').value = day.cardioInfo ? day.cardioInfo.duration : '15–20 min';
    document.getElementById('edit-cardio-type').value = day.cardioInfo ? day.cardioInfo.type : '';
    document.getElementById('edit-cardio-intensity').value = day.cardioInfo ? day.cardioInfo.intensity : 'Suave/moderada';
    document.getElementById('edit-cardio-video').value = (day.cardioInfo && day.cardioInfo.video) || '';
    
    document.getElementById('edit-cardio-modal').classList.add('active');
  }

  closeCardioModal() {
    document.getElementById('edit-cardio-modal').classList.remove('active');
  }

  saveCardio() {
    const day = this.state.routine.days.find(d => d.id === this.editingDayId);
    const enabled = document.getElementById('edit-cardio-enabled').checked;
    
    day.cardio = enabled;
    day.cardioInfo = {
      duration: document.getElementById('edit-cardio-duration').value.trim(),
      type: document.getElementById('edit-cardio-type').value.trim(),
      intensity: document.getElementById('edit-cardio-intensity').value.trim(),
      video: document.getElementById('edit-cardio-video').value.trim()
    };

    this.saveState();
    this.closeCardioModal();
    this.renderRoutineEditor();
    this.renderWorkoutFlow();
    alert("Cardio guardado correctamente.");
  }

  // ACTIVATION / APPROXIMATION EDITORS
  openActivationEdit(dayId) {
    this.editingDayId = dayId;
    const day = this.state.routine.days.find(d => d.id === dayId);
    document.getElementById('edit-activation-enabled').checked = !!day.hasApproximation;
    document.getElementById('edit-activation-info').value = day.approximationInfo || '';
    document.getElementById('edit-activation-video').value = day.activationVideo || '';
    document.getElementById('edit-activation-modal').classList.add('active');
  }

  closeActivationModal() {
    document.getElementById('edit-activation-modal').classList.remove('active');
  }

  saveActivation() {
    const day = this.state.routine.days.find(d => d.id === this.editingDayId);
    day.hasApproximation = document.getElementById('edit-activation-enabled').checked;
    day.approximationInfo = document.getElementById('edit-activation-info').value.trim();
    day.activationVideo = document.getElementById('edit-activation-video').value.trim();
    this.saveState();
    this.closeActivationModal();
    this.renderRoutineEditor();
    this.renderWorkoutFlow();
    alert("Activación guardada correctamente.");
  }

  // COOLDOWN EDITORS
  openCooldownEdit(dayId) {
    this.editingDayId = dayId;
    const day = this.state.routine.days.find(d => d.id === dayId);
    
    document.getElementById('edit-cool-walk').value = day.cooldown.walk || '';
    document.getElementById('edit-cool-walk-video').value = day.cooldown.walkVideo || '';
    document.getElementById('edit-cool-stretch').value = day.cooldown.stretching || '';
    document.getElementById('edit-cool-stretch-video').value = day.cooldown.stretchingVideo || '';
    document.getElementById('edit-cool-vacuum').value = day.cooldown.stomachVacuum || '';
    document.getElementById('edit-cool-vacuum-video').value = day.cooldown.vacuumVideo || '';
    
    document.getElementById('edit-cooldown-modal').classList.add('active');
  }

  closeCooldownModal() {
    document.getElementById('edit-cooldown-modal').classList.remove('active');
  }

  saveCooldown() {
    const day = this.state.routine.days.find(d => d.id === this.editingDayId);
    
    day.cooldown.walk = document.getElementById('edit-cool-walk').value.trim();
    day.cooldown.walkVideo = document.getElementById('edit-cool-walk-video').value.trim();
    day.cooldown.stretching = document.getElementById('edit-cool-stretch').value.trim();
    day.cooldown.stretchingVideo = document.getElementById('edit-cool-stretch-video').value.trim();
    day.cooldown.stomachVacuum = document.getElementById('edit-cool-vacuum').value.trim();
    day.cooldown.vacuumVideo = document.getElementById('edit-cool-vacuum-video').value.trim();

    if (!this.state.routine.hipopresivosDefaults) this.state.routine.hipopresivosDefaults = {};
    this.state.routine.hipopresivosDefaults[this.editingDayId] = day.cooldown.stomachVacuum;

    this.saveState();
    this.closeCooldownModal();
    this.renderRoutineEditor();
    this.renderWorkoutFlow();
    alert("Vuelta a la calma guardada correctamente.");
  }

  // PROGRESS LOGS & CHARTING (TAB PROGRESO)
  logBodyWeight() {
    const input = document.getElementById('input-body-weight');
    const val = parseFloat(input.value);
    
    if (isNaN(val) || val <= 0) {
      alert("Por favor ingresa un peso válido.");
      return;
    }

    const todayStr = this.getTodayDateString();
    
    // Check if today already has a log, overwrite or push
    const existingIdx = this.state.bodyWeightLogs.findIndex(l => l.date === todayStr);
    if (existingIdx !== -1) {
      this.state.bodyWeightLogs[existingIdx].weight = val;
    } else {
      this.state.bodyWeightLogs.push({ date: todayStr, weight: val });
    }

    // Sort chronologically
    this.state.bodyWeightLogs.sort((a, b) => new Date(a.date) - new Date(b.date));

    this.saveState();
    input.value = '';
    this.renderWeightChart();
    alert("Peso registrado con éxito.");
  }

  renderWeightChart() {
    const canvas = document.getElementById('weight-chart');
    if (!canvas) return;

    // Destroy existing instance if any
    if (this.chartInstance) {
      this.chartInstance.destroy();
    }

    const labels = this.state.bodyWeightLogs.map(l => {
      const parts = l.date.split('-');
      return `${parts[2]}/${parts[1]}`; // DD/MM format
    });
    const data = this.state.bodyWeightLogs.map(l => l.weight);

    this.chartInstance = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Peso Corporal (kg)',
          data: data,
          borderColor: '#e879a8',
          backgroundColor: (ctx) => {
            const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, 220);
            gradient.addColorStop(0,   'rgba(232, 121, 168, 0.25)');
            gradient.addColorStop(1,   'rgba(192, 132, 252, 0.03)');
            return gradient;
          },
          borderWidth: 2.5,
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#e879a8',
          pointBorderColor: '#fdf4ff',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(18, 8, 30, 0.95)',
            borderColor: 'rgba(232, 121, 168, 0.3)',
            borderWidth: 1,
            titleColor: '#fdf4ff',
            bodyColor: '#c4b5d4',
            padding: 10,
            cornerRadius: 10
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(200, 130, 255, 0.06)' },
            ticks: { color: '#7c6a95', font: { family: 'Outfit', size: 11 } }
          },
          y: {
            grid: { color: 'rgba(200, 130, 255, 0.06)' },
            ticks: { color: '#7c6a95', font: { family: 'Outfit', size: 11 } }
          }
        }
      }
    });
  }

  populateExerciseSelectors() {
    const selector = document.getElementById('progress-exercise-selector');
    if (!selector) return;

    // Gather all distinct exercises from routine
    selector.innerHTML = '';
    const addedIds = new Set();

    this.state.routine.days.forEach(day => {
      day.exercises.forEach(ex => {
        if (!addedIds.has(ex.id)) {
          addedIds.add(ex.id);
          const option = document.createElement('option');
          option.value = ex.id;
          option.innerText = ex.name;
          selector.appendChild(option);
        }
      });
    });
  }

  renderExerciseHistory() {
    const selector = document.getElementById('progress-exercise-selector');
    const container = document.getElementById('exercise-history-table-container');
    if (!selector || !container) return;

    const exId = selector.value;
    if (!exId) {
      container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Sin datos de ejercicio.</p>';
      return;
    }

    // Filter weightsHistory
    const history = this.state.weightsHistory
      .filter(h => h.exerciseId === exId)
      .sort((a, b) => new Date(b.date) - new Date(a.date)); // newest first

    if (history.length === 0) {
      container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">No hay registros de fuerza cargados para este ejercicio. Completa un entrenamiento en la pestaña "Hoy".</p>';
      return;
    }

    let html = `
      <table class="set-log-table" style="font-size: 13px;">
        <thead>
          <tr>
            <th style="text-align: left;">Fecha</th>
            <th>Series e Historial de Peso x Reps</th>
          </tr>
        </thead>
        <tbody>
    `;

    history.forEach(log => {
      const parts = log.date.split('-');
      const formattedDate = `${parts[2]}/${parts[1]}`;
      
      const setsHtml = log.sets.map((s, idx) => {
        return `<span style="background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; font-size:11px; margin: 2px; display:inline-block;">
          S${idx+1}: <strong>${s.weight}kg</strong> x ${s.reps}
        </span>`;
      }).join(' ');

      html += `
        <tr>
          <td style="text-align: left; vertical-align: top; font-weight:600; width: 80px; padding: 8px 0;">${formattedDate}</td>
          <td style="text-align: left; padding: 8px 0;">${setsHtml}</td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // NUTRITION & CALORIES LOGS (TAB COMIDA)
  renderNutritionTab() {
    const todayStr = this.getTodayDateString();

    if (!this.state.foodLogs[todayStr]) {
      this.state.foodLogs[todayStr] = [];
    }

    const foodList = this.state.foodLogs[todayStr];
    
    // Sum Macros
    let totalCal = 0;
    let totalProt = 0;
    let totalCarb = 0;
    let totalFat = 0;

    foodList.forEach(item => {
      totalCal += item.cal;
      totalProt += item.prot;
      totalCarb += item.carb;
      totalFat += item.fat;
    });

    // Update displays
    document.getElementById('nutri-cal').innerText = totalCal;
    document.getElementById('nutri-prot').innerText = `${totalProt}g`;
    document.getElementById('nutri-carb').innerText = `${totalCarb}g`;
    document.getElementById('nutri-fat').innerText = `${totalFat}g`;

    // Render food entries list
    const container = document.getElementById('food-entries-list');
    if (!container) return;

    if (foodList.length === 0) {
      container.innerHTML = '<p style="font-size:12px; color:var(--text-muted); text-align:center;">No has registrado alimentos hoy.</p>';
    } else {
      let html = '';
      foodList.forEach((food, idx) => {
        html += `
          <div style="display:flex; justify-content:space-between; align-items:center; background: rgba(255,255,255,0.02); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-glass);">
            <div>
              <div style="font-weight:600; font-size:13px;">${food.desc}</div>
              <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">
                ${food.cal}kcal • P: ${food.prot}g • C: ${food.carb}g • G: ${food.fat}g
              </div>
            </div>
            <button onclick="app.deleteFoodEntry(${idx})" style="background:none; border:none; color:var(--color-rose); cursor:pointer;">
              <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
          </div>
        `;
      });
      container.innerHTML = html;
      lucide.createIcons();
    }

    // Render Water tracker
    this.renderWaterGlasses();
  }

  addFoodEntry() {
    const descInput = document.getElementById('food-desc');
    const calInput = document.getElementById('food-cal');
    const protInput = document.getElementById('food-prot');
    const carbInput = document.getElementById('food-carb');
    const fatInput = document.getElementById('food-fat');

    const desc = descInput.value;
    const cal = parseInt(calInput.value) || 0;
    const prot = parseInt(protInput.value) || 0;
    const carb = parseInt(carbInput.value) || 0;
    const fat = parseInt(fatInput.value) || 0;

    if (!desc) {
      alert("Por favor ingresa un nombre para el alimento.");
      return;
    }

    const todayStr = this.getTodayDateString();
    if (!this.state.foodLogs[todayStr]) this.state.foodLogs[todayStr] = [];

    this.state.foodLogs[todayStr].push({
      id: Date.now(),
      desc,
      cal,
      prot,
      carb,
      fat
    });

    this.saveState();
    
    // Clear inputs
    descInput.value = '';
    calInput.value = '';
    protInput.value = '';
    carbInput.value = '';
    fatInput.value = '';

    this.renderNutritionTab();
  }

  deleteFoodEntry(index) {
    const todayStr = this.getTodayDateString();
    this.state.foodLogs[todayStr].splice(index, 1);
    this.saveState();
    this.renderNutritionTab();
  }

  renderWaterGlasses() {
    const todayStr = this.getTodayDateString();
    const count = this.state.waterLogs[todayStr] || 0;
    
    // Update Text
    const waterText = document.getElementById('water-text');
    const liters = (count * 0.25).toFixed(1);
    waterText.innerText = `Vasos de agua de hoy: ${count} / 8 (${liters} L / 2.0 L)`;

    // Render glasses
    const container = document.getElementById('water-glasses-row');
    container.innerHTML = '';
    
    for (let i = 1; i <= 8; i++) {
      const glass = document.createElement('div');
      glass.className = `water-glass-icon ${i <= count ? 'filled' : ''}`;
      glass.addEventListener('click', () => this.toggleWaterGlass(i));
      container.appendChild(glass);
    }
  }

  toggleWaterGlass(index) {
    const todayStr = this.getTodayDateString();
    const currentCount = this.state.waterLogs[todayStr] || 0;
    
    if (index === currentCount && currentCount > 0) {
      // Tap again the latest filled to remove it
      this.state.waterLogs[todayStr] = currentCount - 1;
    } else {
      // Set to index
      this.state.waterLogs[todayStr] = index;
    }

    this.saveState();
    this.renderNutritionTab();
  }

  resetWaterTracker() {
    const todayStr = this.getTodayDateString();
    this.state.waterLogs[todayStr] = 0;
    this.saveState();
    this.renderNutritionTab();
  }

  renderCycleTab() {
    const todayStr = this.getTodayDateString();
    const todayLabel = document.getElementById('symptoms-today-label');
    const symptoms = this.getTodaySymptoms();

    if (todayLabel) {
      const [year, month, day] = todayStr.split('-');
      todayLabel.innerText = `Registro de hoy: ${day}/${month}/${year}`;
    }

    const fields = {
      'symptom-cramps': symptoms.cramps || 'ninguno',
      'symptom-fatigue': symptoms.fatigue || 'normal',
      'symptom-strength': symptoms.strength || 'normal',
      'symptom-bloating': symptoms.bloating || 'ninguna'
    };

    Object.entries(fields).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    });

    this.renderSymptomRecommendationPreview();
  }

  renderSymptomRecommendationPreview() {
    const preview = document.getElementById('symptom-recommendation-preview');
    if (!preview) return;

    const symptoms = {
      cramps: document.getElementById('symptom-cramps')?.value || 'ninguno',
      fatigue: document.getElementById('symptom-fatigue')?.value || 'normal',
      strength: document.getElementById('symptom-strength')?.value || 'normal',
      bloating: document.getElementById('symptom-bloating')?.value || 'ninguna'
    };
    const recommendation = this.getSymptomRecommendation(symptoms);

    preview.className = `symptom-recommendation-card symptom-${recommendation.level}`;
    preview.innerHTML = `
      <div class="symptom-recommendation-title">${recommendation.badge}</div>
      <p>${recommendation.advice}</p>
    `;
  }

  saveSymptoms() {
    const todayStr = this.getTodayDateString();
    const cramps = document.getElementById('symptom-cramps')?.value || 'ninguno';
    const fatigue = document.getElementById('symptom-fatigue')?.value || 'normal';
    const strength = document.getElementById('symptom-strength')?.value || 'normal';
    const bloating = document.getElementById('symptom-bloating')?.value || 'ninguna';

    this.state.cycleSymptoms[todayStr] = {
      cramps,
      fatigue,
      strength,
      bloating
    };

    this.saveState();
    this.renderSymptomRecommendationPreview();
    this.updateCoachWidget();
    alert("Síntomas guardados correctamente.");
  }

  // UTILS
  capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

// ── Auth-driven App Initialization ─────────────────────────────────
window.app = new FemmeFitApp();

document.addEventListener('DOMContentLoaded', () => {
  // Handle any pending redirect result first (mobile/PWA flow)
  getRedirectResult(auth).then((result) => {
    if (result && result.user) {
      console.log('Redirect result received:', result.user.email);
    }
  }).catch((e) => {
    console.warn('getRedirectResult error (can be normal if no pending redirect):', e.code);
  });

  onAuthStateChanged(auth, async (user) => {
    const loadingEl   = document.getElementById('auth-loading');
    const loginEl     = document.getElementById('login-screen');
    const appWrapper  = document.getElementById('app-wrapper');

    if (user) {
      // Signed in: load cloud data then start the app
      window.app.userId = user.uid;
      await window.app.loadFromFirestore(user.uid);

      if (loadingEl) loadingEl.style.display = 'none';
      if (loginEl)   loginEl.style.display   = 'none';
      if (appWrapper) {
        appWrapper.style.display = 'flex';
        appWrapper.style.flexDirection = 'column';
      }

      window.app.init();
      window.app.showUserInfo(user);
    } else {
      // Not signed in: show login screen
      if (loadingEl) loadingEl.style.display = 'none';
      if (loginEl)   loginEl.style.display   = 'flex';
      if (appWrapper) appWrapper.style.display = 'none';
    }
  });
});

// ── Global Auth Helpers (called from HTML onclick) ──────────────────
window.signInWithGoogle = async () => {
  const btn = document.getElementById('btn-google-signin');
  if (btn) { btn.disabled = true; btn.innerText = 'Iniciando sesión...'; }
  try {
    // Try popup first (works on desktop/localhost)
    await signInWithPopup(auth, googleProvider);
  } catch (e) {
    // If popup is blocked, fall back to redirect (mobile PWA)
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/popup-closed-by-user') {
      try {
        await signInWithRedirect(auth, googleProvider);
      } catch (e2) {
        console.error('Redirect sign-in error:', e2);
        if (btn) { btn.disabled = false; btn.innerHTML = 'Continuar con Google'; }
        alert('Error al iniciar sesión: ' + (e2.message || 'intenta de nuevo.'));
      }
    } else {
      console.error('Sign-in error:', e);
      if (btn) { btn.disabled = false; btn.innerHTML = 'Continuar con Google'; }
      alert('Error al iniciar sesión: ' + (e.message || 'intenta de nuevo.'));
    }
  }
};

window.signOutUser = async () => {
  const confirmed = confirm('¿Cerrar sesión en FemmeFit?');
  if (!confirmed) return;
  // Force one last sync before signing out
  await window.app.syncToFirestore();
  await signOut(auth);
  window.location.reload();
};
