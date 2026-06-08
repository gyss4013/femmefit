export const INITIAL_ROUTINE = {
  days: [
    {
      id: "lunes",
      name: "Lunes",
      focus: "Pierna, cuádriceps + glúteo lateral",
      cardio: false,
      warmup: {
        duration: "5 a 8 minutos",
        options: ["Caminadora suave", "Bicicleta", "Elíptica", "Escaladora suave"],
        description: "No debe cansarte. Solo es para subir temperatura."
      },
      mobility: {
        rounds: 2,
        duration: "5 a 8 minutos",
        exercises: [
          { name: "Círculos de cadera", reps: "8 por lado" },
          { name: "Sentadilla profunda asistida o sin peso", reps: "8–10" },
          { name: "Puente de glúteo sin peso", reps: "15" },
          { name: "Caminata lateral con banda", reps: "12–15 pasos por lado" },
          { name: "Extensión de pierna sin peso o sentadilla lenta", reps: "10" }
        ]
      },
      hasApproximation: true,
      approximationInfo: "Antes del hack squat, haz: Serie 1 (muy liviano, 12 reps) y Serie 2 (medio, 8 reps). No cuentan como efectivas.",
      exercises: [
        {
          id: "hack-squat",
          name: "Hack squat",
          sets: 4,
          repsRange: "8–10",
          rest: 120, // en segundos
          type: "heavy",
          unilateral: false,
          keys: "Espalda apoyada, baja controlado, rodillas alineadas con los pies, no rebotes abajo.",
          video: "https://www.youtube.com/watch?v=0k7U5k2_gH0"
        },
        {
          id: "prensa-pies-medios",
          name: "Prensa pies medios",
          sets: 3,
          repsRange: "10–12",
          rest: 90,
          type: "heavy",
          unilateral: false,
          keys: "Pies en posición media, baja hasta donde la cadera no se despegue del asiento.",
          video: "https://www.youtube.com/watch?v=y3hRmWn2jIY"
        },
        {
          id: "sentadilla-smith-goblet",
          name: "Sentadilla Smith o goblet",
          sets: 3,
          repsRange: "10–12",
          rest: 90,
          type: "heavy",
          unilateral: false,
          keys: "Espalda firme, rodillas hacia afuera alineadas con los pies, controla el descenso.",
          video: "https://www.youtube.com/watch?v=t_k8tL0A9b8"
        },
        {
          id: "extension-cuadriceps",
          name: "Extensión de cuádriceps",
          sets: 3,
          repsRange: "12–15",
          rest: 60,
          type: "isolation",
          unilateral: false,
          keys: "Aprieta el cuádriceps arriba 1 segundo, baja lento.",
          video: "https://www.youtube.com/watch?v=m0FOpMEgero"
        },
        {
          id: "femoral-sentado",
          name: "Femoral sentado",
          sets: 3,
          repsRange: "10–12",
          rest: 75,
          type: "isolation",
          unilateral: false,
          keys: "Controla la bajada, no levantes la cadera del asiento.",
          video: "https://www.youtube.com/watch?v=F3_MK2Bw1AI"
        },
        {
          id: "abduccion-maquina",
          name: "Abducción en máquina",
          sets: 3, // rango 3-4, inicial 3
          repsRange: "15–25",
          rest: 45,
          type: "isolation",
          unilateral: false,
          keys: "Torso ligeramente inclinado hacia adelante, abre controlado, pausa 1 segundo, no uses impulso.",
          video: "https://www.youtube.com/watch?v=SEdqBc_qFII"
        }
      ],
      cooldown: {
        walk: "3–5 min caminando suave",
        stretching: "5 min de estiramiento suave",
        stomachVacuum: "8–10 min hipopresivos (opcional al final o en casa)"
      }
    },
    {
      id: "martes",
      name: "Martes",
      focus: "Espalda definida + pecho moderado",
      cardio: true,
      cardioInfo: { duration: "15–20 min", type: "Caminadora inclinada, bici o elíptica", intensity: "Suave/moderada" },
      warmup: {
        duration: "5 a 8 minutos",
        options: ["Caminadora suave", "Bicicleta", "Elíptica"],
        description: "Subir temperatura general."
      },
      mobility: {
        rounds: 2,
        duration: "5 a 8 minutos",
        exercises: [
          { name: "Rotaciones de hombros hacia adelante", reps: "10" },
          { name: "Rotaciones de hombros hacia atrás", reps: "10" },
          { name: "Aperturas con banda o band pull-aparts", reps: "15" },
          { name: "Face pull muy liviano", reps: "15" },
          { name: "Scapular pull-down en polea o banda", reps: "12" }
        ]
      },
      hasApproximation: true,
      approximationInfo: "Antes del jalón al pecho o del remo, haz 1–2 series livianas.",
      exercises: [
        {
          id: "jalon-pecho",
          name: "Jalón al pecho",
          sets: 3,
          repsRange: "10–12",
          rest: 75,
          type: "isolation",
          unilateral: false,
          keys: "Lleva los codos hacia abajo, no tires solo con las manos.",
          video: "https://www.youtube.com/watch?v=SALxL6RtG34"
        },
        {
          id: "remo-maquina-polea",
          name: "Remo en máquina o polea baja",
          sets: 3,
          repsRange: "10–12",
          rest: 75,
          type: "isolation",
          unilateral: false,
          keys: "Junta ligeramente escápulas, no encojas hombros.",
          video: "https://www.youtube.com/watch?v=sP_4vybh3hw"
        },
        {
          id: "pullover-polea",
          name: "Pullover en polea",
          sets: 3,
          repsRange: "12–15",
          rest: 60,
          type: "isolation",
          unilateral: false,
          keys: "Brazos casi extendidos, siente dorsal, no tríceps.",
          video: "https://www.youtube.com/watch?v=Gk743s0C-0s"
        },
        {
          id: "press-plano-mancuernas",
          name: "Press plano con mancuernas",
          sets: 2,
          repsRange: "10–12",
          rest: 75,
          type: "isolation",
          unilateral: false,
          keys: "Controla la bajada, codos a 45 grados, empuja con fuerza.",
          video: "https://www.youtube.com/watch?v=VmBQ_7P1ZgM"
        },
        {
          id: "cristos-maquina",
          name: "Cristos en máquina",
          sets: 2,
          repsRange: "12–15",
          rest: 60,
          type: "isolation",
          unilateral: false,
          keys: "Siente estiramiento en pecho, junta controlado.",
          video: "https://www.youtube.com/watch?v=480M7lF46W0"
        },
        {
          id: "face-pull",
          name: "Face pull",
          sets: 3,
          repsRange: "15–20",
          rest: 45,
          type: "isolation",
          unilateral: false,
          keys: "Codos altos, cuerda hacia la cara, controlado.",
          video: "https://www.youtube.com/watch?v=rep-q_aO1Yg"
        },
        {
          id: "elevaciones-laterales",
          name: "Elevaciones laterales",
          sets: 3,
          repsRange: "12–15",
          rest: 45,
          type: "isolation",
          unilateral: false,
          keys: "Peso moderado, sin balancear el cuerpo.",
          video: "https://www.youtube.com/watch?v=2K0v_V2T2jE"
        }
      ],
      cooldown: {
        walk: "3–5 min caminando suave",
        stretching: "5 min de espalda, pecho y hombros",
        stomachVacuum: "8–12 min hipopresivos"
      }
    },
    {
      id: "miercoles",
      name: "Miércoles",
      focus: "Glúteo completo",
      cardio: false,
      warmup: {
        duration: "5 a 8 minutos",
        options: ["Caminadora suave", "Bicicleta", "Elíptica"],
        description: "Subir temperatura general."
      },
      mobility: {
        rounds: 2,
        duration: "5 a 8 minutos",
        exercises: [
          { name: "Círculos de cadera", reps: "8 por lado" },
          { name: "Puente de glúteo sin peso", reps: "15" },
          { name: "Caminata lateral con banda", reps: "12–15 pasos por lado" },
          { name: "Patada de glúteo con banda o sin peso", reps: "12 por pierna" },
          { name: "Abducción con banda", reps: "15–20" }
        ]
      },
      hasApproximation: true,
      approximationInfo: "Antes del hip thrust, haz: Serie 1 (muy liviano, 12 reps) y Serie 2 (medio, 8 reps).",
      exercises: [
        {
          id: "hip-thrust",
          name: "Hip thrust",
          sets: 4,
          repsRange: "8–10",
          rest: 120,
          type: "heavy",
          unilateral: false,
          keys: "Pausa 1 segundo arriba, mentón ligeramente hacia el pecho, costillas abajo, no hiperextiendas la espalda.",
          video: "https://www.youtube.com/watch?v=LM8XHlyJoYs"
        },
        {
          id: "bulgara-inclinada",
          name: "Búlgara inclinada",
          sets: 3,
          repsRange: "8–10",
          rest: 90,
          type: "heavy",
          unilateral: true,
          keys: "Paso largo, torso levemente inclinado, empuja desde el talón. Haz un lado, descansa y luego el otro.",
          video: "https://www.youtube.com/watch?v=2C-uNgKwPLE"
        },
        {
          id: "peso-muerto-rumano",
          name: "Peso muerto rumano",
          sets: 3,
          repsRange: "8–10",
          rest: 120,
          type: "heavy",
          unilateral: false,
          keys: "Cadera hacia atrás, espalda neutra, rodillas ligeramente flexionadas, baja hasta sentir estiramiento en femoral/glúteo.",
          video: "https://www.youtube.com/watch?v=JCXUYuzwCFM"
        },
        {
          id: "patada-diagonal-polea",
          name: "Patada diagonal en polea",
          sets: 3,
          repsRange: "12–15",
          rest: 60,
          type: "isolation",
          unilateral: true,
          keys: "No solo hacia atrás; hazla hacia atrás y ligeramente hacia afuera para trabajar más glúteo lateral/superior.",
          video: "https://www.youtube.com/watch?v=P21rGZ_g6H0"
        },
        {
          id: "abduccion-maquina-gluteo",
          name: "Abducción en máquina",
          sets: 4,
          repsRange: "15–25",
          rest: 45,
          type: "isolation",
          unilateral: false,
          keys: "Torso ligeramente inclinado hacia adelante, abre controlado, pausa 1 segundo.",
          video: "https://www.youtube.com/watch?v=SEdqBc_qFII"
        },
        {
          id: "aductores",
          name: "Aductores",
          sets: 3,
          repsRange: "12–15",
          rest: 60,
          type: "isolation",
          unilateral: false,
          keys: "Ayudan a pierna más completa, estabilidad de pelvis y estética del muslo interno.",
          video: "https://www.youtube.com/watch?v=48S2jCms3w8"
        }
      ],
      cooldown: {
        walk: "3–5 min caminando suave",
        stretching: "5–8 min de glúteo, femoral, cadera y aductores",
        stomachVacuum: "8–10 min hipopresivos"
      }
    },
    {
      id: "jueves",
      name: "Jueves",
      focus: "Brazos definidos + hombro + core",
      cardio: true,
      cardioInfo: { duration: "20–25 min", type: "Caminadora inclinada, bici o elíptica", intensity: "Suave/moderada" },
      warmup: {
        duration: "5 a 8 minutos",
        options: ["Caminadora suave", "Bicicleta", "Elíptica"],
        description: "Subir temperatura general."
      },
      mobility: {
        rounds: 2,
        duration: "5 minutos",
        exercises: [
          { name: "Rotaciones de hombros", reps: "10 adelante / 10 atrás" },
          { name: "Aperturas con banda", reps: "15" },
          { name: "Rotación externa con banda", reps: "12 por lado" },
          { name: "Movilidad de muñecas", reps: "20–30 s" },
          { name: "Face pull liviano", reps: "12–15" }
        ]
      },
      hasApproximation: false,
      exercises: [
        {
          id: "curl-predicador",
          name: "Curl predicador",
          sets: 3,
          repsRange: "10–12",
          rest: 60,
          type: "isolation",
          unilateral: false,
          keys: "No uses impulso. Queremos definición, no mover peso por moverlo.",
          video: "https://www.youtube.com/watch?v=fIWM-Gr15mY"
        },
        {
          id: "extension-triceps-polea",
          name: "Extensión de tríceps en polea",
          sets: 3,
          repsRange: "10–12",
          rest: 60,
          type: "isolation",
          unilateral: false,
          keys: "Mantén los codos pegados al cuerpo, extiende completo.",
          video: "https://www.youtube.com/watch?v=2-LAMcpzODU"
        },
        {
          id: "curl-martillo",
          name: "Curl martillo",
          sets: 2,
          repsRange: "12",
          rest: 60,
          type: "isolation",
          unilateral: false,
          keys: "Espalda quieta, sube apretando el braquial, baja lento.",
          video: "https://www.youtube.com/watch?v=7e7H0SCl1pA"
        },
        {
          id: "triceps-sobre-cabeza",
          name: "Tríceps sobre cabeza con mancuerna",
          sets: 2,
          repsRange: "10–12",
          rest: 60,
          type: "isolation",
          unilateral: false,
          keys: "Codos apuntando al frente, no los abras hacia los lados.",
          video: "https://www.youtube.com/watch?v=Kb37P6r_Osw"
        },
        {
          id: "elevaciones-laterales-hombro",
          name: "Elevaciones laterales",
          sets: 3,
          repsRange: "12–15",
          rest: 45,
          type: "isolation",
          unilateral: false,
          keys: "Ayudan a una figura más proporcionada, usa carga moderada.",
          video: "https://www.youtube.com/watch?v=2K0v_V2T2jE"
        },
        {
          id: "pajaros-facepull",
          name: "Pájaros o face pull",
          sets: 3, // rango 2-3
          repsRange: "15–20",
          rest: 45,
          type: "isolation",
          unilateral: false,
          keys: "Controla el movimiento, siente la parte posterior del hombro.",
          video: "https://www.youtube.com/watch?v=rep-q_aO1Yg"
        },
        {
          id: "plancha-core",
          name: "Plancha",
          sets: 3,
          repsRange: "30–45 s",
          rest: 45,
          type: "core",
          unilateral: false,
          keys: "Estabilidad, postura y control. Evita balanceos, contrae abdomen.",
          video: "https://www.youtube.com/watch?v=ASdVdO37KPI"
        },
        {
          id: "dead-bug",
          name: "Dead bug",
          sets: 3,
          repsRange: "10 por lado",
          rest: 45,
          type: "core",
          unilateral: true,
          keys: "Mantén la espalda baja plana contra el suelo en todo momento.",
          video: "https://www.youtube.com/watch?v=g_BYB0R-4Ws"
        },
        {
          id: "pallof-press",
          name: "Pallof press",
          sets: 2,
          repsRange: "12 por lado",
          rest: 45,
          type: "core",
          unilateral: true,
          keys: "Caderas firmes, empuja la polea hacia el frente sin que te jale.",
          video: "https://www.youtube.com/watch?v=nO3Z9V41Wv8"
        }
      ],
      cooldown: {
        walk: "3–5 min caminando suave",
        stretching: "5 min de brazos, hombros y espalda",
        stomachVacuum: "10–12 min hipopresivos"
      }
    },
    {
      id: "viernes",
      name: "Viernes",
      focus: "Glúteo/femoral + pierna completa",
      cardio: false,
      warmup: {
        duration: "5 a 8 minutos",
        options: ["Caminadora suave", "Bicicleta", "Elíptica"],
        description: "Subir temperatura general."
      },
      mobility: {
        rounds: 2,
        duration: "5 a 8 minutos",
        exercises: [
          { name: "Círculos de cadera", reps: "8 por lado" },
          { name: "Puente de glúteo", reps: "15" },
          { name: "Caminata lateral con banda", reps: "12–15 pasos por lado" },
          { name: "Buenos días sin peso o con banda", reps: "10" },
          { name: "Sentadilla lenta sin peso", reps: "8–10" }
        ]
      },
      hasApproximation: true,
      approximationInfo: "Antes de la sentadilla Smith: Serie 1 (muy liviano, 12 reps) y Serie 2 (medio, 8 reps).",
      exercises: [
        {
          id: "sentadilla-smith-adelantada",
          name: "Sentadilla Smith (pies adelantados)",
          sets: 3,
          repsRange: "8–10",
          rest: 120,
          type: "heavy",
          unilateral: false,
          keys: "Pies un poco adelantados, baja controlado, rodillas alineadas.",
          video: "https://www.youtube.com/watch?v=t_k8tL0A9b8"
        },
        {
          id: "zancadas-estaticas",
          name: "Zancadas estáticas",
          sets: 3,
          repsRange: "10–12",
          rest: 90,
          type: "heavy",
          unilateral: true,
          keys: "Paso largo, torso ligeramente inclinado hacia adelante, empuja desde el talón.",
          video: "https://www.youtube.com/watch?v=N64_A6QY7aM"
        },
        {
          id: "hip-thrust-moderado",
          name: "Hip thrust moderado",
          sets: 3,
          repsRange: "10–12",
          rest: 90,
          type: "heavy",
          unilateral: false,
          keys: "No lo hagas tan pesado como el miércoles. Aquí importa más conexión, pausa y control.",
          video: "https://www.youtube.com/watch?v=LM8XHlyJoYs"
        },
        {
          id: "femoral-sentado-acostado",
          name: "Femoral sentado o acostado",
          sets: 3,
          repsRange: "10–12",
          rest: 75,
          type: "isolation",
          unilateral: false,
          keys: "Si tienes femoral sentado disponible, úsalo. Si no, femoral acostado sirve.",
          video: "https://www.youtube.com/watch?v=F3_MK2Bw1AI"
        },
        {
          id: "prensa-pies-altos",
          name: "Prensa pies altos y abiertos",
          sets: 3,
          repsRange: "12",
          rest: 90,
          type: "heavy",
          unilateral: false,
          keys: "Enfoca más glúteo/femoral. No despegues la cadera del respaldo.",
          video: "https://www.youtube.com/watch?v=y3hRmWn2jIY"
        },
        {
          id: "abduccion-maquina-viernes",
          name: "Abducción en máquina",
          sets: 3,
          repsRange: "15–25",
          rest: 45,
          type: "isolation",
          unilateral: false,
          keys: "Último estímulo fuerte para glúteo medio/lateral.",
          video: "https://www.youtube.com/watch?v=SEdqBc_qFII"
        },
        {
          id: "aductores-opcional",
          name: "Aductores (opcional)",
          sets: 2,
          repsRange: "15",
          rest: 60,
          type: "isolation",
          unilateral: false,
          keys: "Hazlos solo si no sientes sobrecarga en ingle/cadera.",
          video: "https://www.youtube.com/watch?v=48S2jCms3w8"
        }
      ],
      cooldown: {
        walk: "3–5 min caminando suave",
        stretching: "5–8 min de pierna/glúteo",
        stomachVacuum: "8–10 min hipopresivos"
      }
    }
  ],
  hipopresivosDefaults: {
    lunes: "8–10 min",
    martes: "8–12 min",
    miercoles: "8–10 min",
    jueves: "10–12 min",
    viernes: "8–10 min",
    sabado: "Opcional 10 min",
    domingo: "Opcional 10 min"
  }
};
