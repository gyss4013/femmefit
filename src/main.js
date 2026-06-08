import Chart from 'chart.js/auto';
import { INITIAL_ROUTINE } from './routine-data.js';
import { auth, db, googleProvider } from './firebase.js';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
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
    return d.toISOString().split('T')[0];
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
      btnWarmup.addEventListener('click', () => this.startPhaseTimer('warmup', 300, btnWarmup));
    }

    // Cooldown Timer
    const btnCooldown = document.getElementById('btn-start-cooldown');
    if (btnCooldown) {
      btnCooldown.addEventListener('click', () => this.startPhaseTimer('cooldown', 180, btnCooldown));
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
        this.startPhaseTimer('hipopresivos', duration, btnHipo);
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

  // CYCLE CALCULATIONS & INTERFACE
  calculateMenstrualCycle() {
    const today = new Date(this.getTodayDateString());
    
    // Check for manual override first
    if (this.state.manualCyclePhase && this.state.manualCyclePhaseDate) {
      const overrideDate = new Date(this.state.manualCyclePhaseDate);
      const diffTime = Math.abs(today - overrideDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      // Override is valid for 7 days or until next period log
      if (diffDays <= 7) {
        return {
          phase: this.state.manualCyclePhase,
          day: 'Ajuste Manual',
          isOverridden: true
        };
      } else {
        // Clear expired override
        this.state.manualCyclePhase = null;
        this.state.manualCyclePhaseDate = null;
        this.saveState();
      }
    }

    if (!this.state.periodLogs || this.state.periodLogs.length === 0) {
      return {
        phase: 'folicular',
        day: '?',
        isOverridden: false,
        note: 'Registra tu periodo para sincronizar con precisión.'
      };
    }

    // Get the most recent period start date
    const sortedPeriods = [...this.state.periodLogs].sort((a, b) => new Date(b.date) - new Date(a.date));
    const lastPeriod = new Date(sortedPeriods[0].date);
    
    // Calculate difference in days
    const diffTime = today - lastPeriod;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      // Future logged date
      return { phase: 'folicular', day: '?', isOverridden: false };
    }

    // Irregular fallback logic using average cycle length
    const cycleLength = this.state.cycleLength || 28;
    const currentDay = (diffDays % cycleLength) + 1;

    let phase = 'folicular';
    if (currentDay <= 5) {
      phase = 'menstrual';
    } else if (currentDay >= 6 && currentDay <= 12) {
      phase = 'folicular';
    } else if (currentDay >= 13 && currentDay <= 16) {
      phase = 'ovulacion';
    } else {
      phase = 'lutea';
    }

    return {
      phase,
      day: currentDay,
      isOverridden: false
    };
  }

  updateCoachWidget() {
    const cycle = this.calculateMenstrualCycle();
    const widget = document.getElementById('today-coach-widget');
    const phaseBadge = document.getElementById('today-coach-phase');
    const adviceText = document.getElementById('today-coach-text');
    const headerBadge = document.getElementById('header-cycle-badge');

    if (!widget || !phaseBadge || !adviceText) return;

    // Remove old classes
    phaseBadge.className = 'cycle-phase-badge';
    phaseBadge.classList.add(cycle.phase);
    
    // Header Badge update
    if (headerBadge) {
      headerBadge.style.display = 'inline-block';
      headerBadge.className = 'cycle-phase-badge ' + cycle.phase;
      headerBadge.innerText = this.capitalize(cycle.phase);
    }

    // Set Text according to phase
    let phaseName = '';
    let advice = '';

    switch (cycle.phase) {
      case 'menstrual':
        phaseName = `Fase Menstrual (Día ${cycle.day})`;
        advice = '🩸 **Hormonas bajas, menor energía.** Prioriza la técnica de cargas. Si sientes cólicos fuertes o mucha fatiga, baja el peso a un 70-80% o haz solo movilidad/hipopresivos. Mantén el agua alta.';
        widget.style.borderLeft = '4px solid var(--phase-menstrual)';
        break;
      case 'folicular':
        phaseName = `Fase Folicular (Día ${cycle.day})`;
        advice = '⚡ **Estrógenos en aumento, energía a tope.** Es el momento óptimo para aplicar la doble sobrecarga progresiva. Intenta completar el rango superior de repeticiones (ej. 12 reps) y subir peso en ejercicios pesados.';
        widget.style.borderLeft = '4px solid var(--phase-folicular)';
        break;
      case 'ovulacion':
        phaseName = `Fase Ovulatoria (Día ${cycle.day})`;
        advice = '🔥 **Fuerza máxima, pero tendones más laxos.** Gran momento de rendimiento. Calienta concienzudamente tus series de aproximación para evitar lesiones articulares.';
        widget.style.borderLeft = '4px solid var(--phase-ovulacion)';
        break;
      case 'lutea':
        phaseName = `Fase Lútea (Día ${cycle.day})`;
        advice = '🌡️ **Progesterona alta, retención de líquidos.** Tu temperatura corporal sube y el cardio puede sentirse más difícil. No te exijas batir récords si te sientes fatigada; prioriza la consistencia y el control excéntrico.';
        widget.style.borderLeft = '4px solid var(--phase-lutea)';
        break;
    }

    if (cycle.isOverridden) {
      phaseName += ' (Ajuste Manual)';
    }

    phaseBadge.innerText = phaseName;
    adviceText.innerHTML = advice;
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

    // Setup Movilidad
    const mobilityList = document.getElementById('mobility-exercises-list');
    mobilityList.innerHTML = '';
    dayData.mobility.exercises.forEach((ex, idx) => {
      const div = document.createElement('div');
      div.className = 'check-item';
      div.innerHTML = `
        <input type="checkbox" id="check-mob-${idx}" ${this.state.completedSteps[todayStr][`mob-${idx}`] ? 'checked' : ''} onchange="app.saveCheckState('mob-${idx}', this.checked)" />
        <div class="custom-checkbox"></div>
        <span>${ex.name} (${ex.reps})</span>
      `;
      mobilityList.appendChild(div);
    });
    const checkMobility = document.getElementById('check-mobility-done');
    checkMobility.checked = !!this.state.completedSteps[todayStr]['step-mobility'];
    this.completeStepVisual('step-mobility', checkMobility.checked);

    // Setup Aproximación
    const stepApprox = document.getElementById('step-approximation');
    if (dayData.hasApproximation) {
      stepApprox.style.display = 'block';
      document.getElementById('approx-text').innerText = dayData.approximationInfo;
      const checkApprox = document.getElementById('check-approx-done');
      checkApprox.checked = !!this.state.completedSteps[todayStr]['step-approximation'];
      this.completeStepVisual('step-approximation', checkApprox.checked);
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
            <button class="btn btn-secondary btn-small" style="padding: 4px 8px;" onclick="app.playVideo('${ex.name}', '${ex.video}')">
              <i data-lucide="video" style="width: 12px; height: 12px;"></i> Video
            </button>
            <span style="font-size: 11px; color: var(--color-rose); font-weight: 600; padding: 4px 8px; background: rgba(244, 63, 94, 0.08); border-radius: 6px;">
              ${ex.sets}x${ex.repsRange}
            </span>
          </div>
        </div>
        <div class="exercise-keys-note">${ex.keys}</div>
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
    if (dayData.cardio) {
      document.getElementById('cardio-subtitle').innerText = `${dayData.cardioInfo.duration} • ${dayData.cardioInfo.type}`;
      cardioContent.innerHTML = `
        <p style="font-size: 13px; margin-bottom: 12px; color: var(--text-secondary);">
          <strong style="color: var(--text-primary);">Intensidad:</strong> ${dayData.cardioInfo.intensity}. Mantenlo controlado.<br/>
          <em>El cardio es para salud y cintura controlada, no para quemarte.</em>
        </p>
        <button class="btn btn-lavender btn-small btn-cardio-start" style="margin-bottom: 12px;" onclick="app.startCardioTimer('${dayData.cardioInfo.duration}')">
          ▶ Iniciar Temporizador de Cardio (${dayData.cardioInfo.duration})
        </button>
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

    // Cooldown
    const checkCooldown = document.getElementById('check-cooldown-done');
    checkCooldown.checked = !!this.state.completedSteps[todayStr]['step-cooldown'];
    this.completeStepVisual('step-cooldown', checkCooldown.checked);

    // Stretching
    const checkStretching = document.getElementById('check-stretching-done');
    checkStretching.checked = !!this.state.completedSteps[todayStr]['step-stretching'];
    this.completeStepVisual('step-stretching', checkStretching.checked);
    document.getElementById('stretching-desc').innerText = dayData.cooldown.stretching;

    // Hipopresivos
    const checkHipopresivos = document.getElementById('check-hipopresivos-done');
    checkHipopresivos.checked = !!this.state.completedSteps[todayStr]['step-hipopresivos'];
    this.completeStepVisual('step-hipopresivos', checkHipopresivos.checked);
    
    const defaultHipoTime = this.state.routine.hipopresivosDefaults[dayId] || "8–10 min";
    document.getElementById('hipopresivos-subtitle').innerText = `${defaultHipoTime} • Hipopresivos Diarios`;

    lucide.createIcons();
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
  startTimer(seconds, isUnilateral) {
    // Clear previous timer
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.timerRemaining = seconds;
    this.isTimerPaused = false;

    // Show Rest Timer floating drawer
    const drawer = document.getElementById('floating-timer');
    drawer.classList.add('show');

    // Unilateral UI states
    const unilateralCheckbox = document.getElementById('timer-unilateral-checkbox');
    unilateralCheckbox.checked = isUnilateral;
    this.toggleUnilateralRestVisual(isUnilateral, seconds);

    this.updateTimerDisplay();

    this.timerInterval = setInterval(() => {
      if (!this.isTimerPaused) {
        this.timerRemaining--;
        this.updateTimerDisplay();

        if (this.timerRemaining <= 0) {
          clearInterval(this.timerInterval);
          this.playBeep();
          this.closeTimer();
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
    this.timerRemaining += seconds;
    this.updateTimerDisplay();
  }

  resetTimer() {
    this.timerRemaining = this.timerTarget;
    this.updateTimerDisplay();
  }

  closeTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    const drawer = document.getElementById('floating-timer');
    drawer.classList.remove('show');
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
      
      let exercisesHtml = '';
      day.exercises.forEach(ex => {
        exercisesHtml += `
          <div class="routine-exercise-item">
            <div>
              <div style="font-weight:600; font-size:14px;">${ex.name}</div>
              <div style="font-size:12px; color: var(--text-secondary); margin-top:2px;">
                ${ex.sets} series x ${ex.repsRange} reps • ${ex.rest}s descanso
              </div>
            </div>
            <button class="btn btn-secondary btn-small" onclick="app.openEditModal('${day.id}', '${ex.id}')">
              <i data-lucide="edit-3" style="width:12px; height:12px;"></i> Editar
            </button>
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
          ${exercisesHtml}
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

    const day = this.state.routine.days.find(d => d.id === dayId);
    const ex = day.exercises.find(e => e.id === exId);

    document.getElementById('edit-ex-name').value = ex.name;
    document.getElementById('edit-ex-sets').value = ex.sets;
    document.getElementById('edit-ex-reps').value = ex.repsRange;
    document.getElementById('edit-ex-rest').value = ex.rest;
    document.getElementById('edit-ex-keys').value = ex.keys;
    document.getElementById('edit-ex-video').value = ex.video;

    document.getElementById('edit-exercise-modal').classList.add('active');
  }

  closeEditModal() {
    document.getElementById('edit-exercise-modal').classList.remove('active');
  }

  saveEditedExercise() {
    const day = this.state.routine.days.find(d => d.id === this.editingDayId);
    const ex = day.exercises.find(e => e.id === this.editingExId);

    ex.name = document.getElementById('edit-ex-name').value;
    ex.sets = parseInt(document.getElementById('edit-ex-sets').value) || ex.sets;
    ex.repsRange = document.getElementById('edit-ex-reps').value;
    ex.rest = parseInt(document.getElementById('edit-ex-rest').value) || ex.rest;
    ex.keys = document.getElementById('edit-ex-keys').value;
    ex.video = document.getElementById('edit-ex-video').value;

    this.saveState();
    this.closeEditModal();
    this.renderRoutineEditor();
    this.renderWorkoutFlow();
    alert("Ejercicio guardado correctamente.");
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

  // MENSTRUAL CYCLE LOGGING TAB
  renderCycleTab() {
    // Populate Period logs list
    const container = document.getElementById('period-history-list');
    if (!container) return;

    if (!this.state.periodLogs || this.state.periodLogs.length === 0) {
      container.innerHTML = '<p style="font-size:12px; color:var(--text-muted); text-align:center;">No hay registros cargados.</p>';
    } else {
      const sorted = [...this.state.periodLogs].sort((a, b) => new Date(b.date) - new Date(a.date));
      let html = '';
      sorted.forEach((log, idx) => {
        const parts = log.date.split('-');
        const formatted = `${parts[2]}/${parts[1]}/${parts[0]}`;
        html += `
          <div class="cycle-log-item">
            <span>Periodo iniciado el: <strong>${formatted}</strong></span>
            <button onclick="app.deletePeriodLog(${idx})" style="background:none; border:none; color:var(--color-rose); cursor:pointer;">
              <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
          </div>
        `;
      });
      container.innerHTML = html;
      lucide.createIcons();
    }

    // Restore today symptoms visual values if logged
    const todayStr = this.getTodayDateString();
    const symptoms = this.state.cycleSymptoms[todayStr];
    if (symptoms) {
      document.getElementById('symptom-cramps').value = symptoms.cramps || 'ninguno';
      document.getElementById('symptom-fatigue').value = symptoms.fatigue || 'normal';
      document.getElementById('symptom-strength').value = symptoms.strength || 'normal';
      document.getElementById('symptom-bloating').value = symptoms.bloating || 'ninguna';
    }

    // Set select selector override value matching current state
    const cycle = this.calculateMenstrualCycle();
    document.getElementById('select-manual-phase').value = cycle.phase;
  }

  logPeriodStart() {
    const input = document.getElementById('input-period-date');
    const val = input.value;

    if (!val) {
      alert("Por favor selecciona una fecha válida.");
      return;
    }

    // Add only if not duplicated
    const duplicated = this.state.periodLogs.some(p => p.date === val);
    if (!duplicated) {
      this.state.periodLogs.push({ date: val });
      // Reset manual overrides once period is logged
      this.state.manualCyclePhase = null;
      this.state.manualCyclePhaseDate = null;
      this.saveState();
    }

    this.renderCycleTab();
    this.updateCoachWidget();
    alert("Periodo registrado con éxito.");
  }

  deletePeriodLog(index) {
    this.state.periodLogs.splice(index, 1);
    this.saveState();
    this.renderCycleTab();
    this.updateCoachWidget();
  }

  manualPhaseChange(phase) {
    const todayStr = this.getTodayDateString();
    this.state.manualCyclePhase = phase;
    this.state.manualCyclePhaseDate = todayStr;
    this.saveState();
    this.updateCoachWidget();
    alert(`Fase menstrual configurada manualmente como: ${this.capitalize(phase)}. Durará 7 días.`);
  }

  saveSymptoms() {
    const todayStr = this.getTodayDateString();
    const cramps = document.getElementById('symptom-cramps').value;
    const fatigue = document.getElementById('symptom-fatigue').value;
    const strength = document.getElementById('symptom-strength').value;
    const bloating = document.getElementById('symptom-bloating').value;

    this.state.cycleSymptoms[todayStr] = {
      cramps,
      fatigue,
      strength,
      bloating
    };

    this.saveState();
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
    await signInWithPopup(auth, googleProvider);
    // onAuthStateChanged will handle the rest
  } catch (e) {
    console.error('Sign-in error:', e);
    if (btn) { btn.disabled = false; btn.innerHTML = 'Continuar con Google'; }
    alert('Error al iniciar sesión. Asegúrate de que las ventanas emergentes estén permitidas.');
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
