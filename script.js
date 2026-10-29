// ============================================================================
// Dimensionado de cintas transportadoras
// script.js: carga los JSON, calcula y dibuja los resultados.
//
// El archivo tiene dos partes:
//   1. CÁLCULO: funciones puras (no tocan la página). Se pueden probar en Node.
//   2. INTERFAZ: lectura del formulario, escritura de resultados y dibujo en <canvas>.
// ============================================================================

"use strict";

// ----------------------------------------------------------------------------
// 1. CÁLCULO
// ----------------------------------------------------------------------------

const aRad = grados => grados * Math.PI / 180;
const aGrados = rad => rad * 180 / Math.PI;

// Formato numérico en español: coma decimal.
function fmt(x, dec = 2) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return x.toLocaleString("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Interpolación lineal en una tabla (xs crecientes). Fuera de rango, toma el extremo.
function interpolar(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 0; i < xs.length - 1; i++) {
    if (x >= xs[i] && x <= xs[i + 1]) {
      return ys[i] + (ys[i + 1] - ys[i]) * (x - xs[i]) / (xs[i + 1] - xs[i]);
    }
  }
  return ys[ys.length - 1];
}

// Coeficiente de seguridad S según el número de capas (Tabla 4.1).
function coefSeguridad(z, tablas) {
  for (const rango of tablas.coeficienteSeguridad.rangos) {
    if (z <= rango.zMax) return rango.S;
  }
  return 13;
}

/**
 * Propiedades de cálculo de un material de materiales.json:
 * densidad media (kg/m³), ángulo de sobrecarga β (°) y clase sugerida de la Tabla 1.3.
 */
function propiedadesMaterial(m, doc) {
  const res = { rho: null, beta: null, origenBeta: "", fluidez: m.fluidez, clase: "" };
  if (m.densidad) res.rho = Math.round((m.densidad[0] + m.densidad[1]) / 2 * 1000);
  let fluidez = m.fluidez;
  if (!fluidez && m.reposo) {
    // Sin fluidez en la tabla: se estima con el ángulo de reposo (diapositiva 10).
    const a = (m.reposo[0] + m.reposo[1]) / 2;
    const lim = doc.reposoFluidez.limites;
    const i = lim.findIndex(l => a <= l);
    fluidez = doc.reposoFluidez.fluidez[i === -1 ? lim.length : i];
    res.origenBeta = `fluidez estimada «${fluidez}» con α = ${fmt(a, 0)}°`;
  } else if (fluidez) {
    res.origenBeta = `fluidez «${fluidez}»`;
  }
  res.fluidez = fluidez || null;
  if (fluidez && doc.fluidezSobrecarga[fluidez] !== undefined) res.beta = doc.fluidezSobrecarga[fluidez];
  if (res.rho !== null) {
    const t = res.rho / 1000;
    let clase = t <= 1 ? "A" : t <= 1.5 ? "B" : t <= 2 ? "C" : "D";
    const otras = (m.otras || "").toLowerCase();
    const muy = otras.includes("muy abras");
    const algo = otras.includes("abras") && !otras.includes("no abras");
    if (muy && (clase === "A" || clase === "B")) clase = "C";
    else if (algo && clase === "A") clase = "B";
    res.clase = clase;
  }
  return res;
}

/**
 * Sección del material S (m²) para un ancho B dado, con el método de sección elegido.
 * Devuelve null si no hay datos para ese ancho (p. ej. sin estación de 3 rodillos).
 * Se usa para buscar el ancho o la velocidad que dan un caudal pedido.
 */
function seccionMaterial(B, d, tablas) {
  B = Number(B);
  if (d.metodoSeccion === "geometrico") {
    const Bm = B / 1000;
    const b = Bm <= 2 ? 0.9 * Bm - 0.05 : Bm - 0.2;
    const n = Number(d.nRodillos);
    const lambda = n === 1 ? 0 : aRad(d.lambda);
    const talud = aRad(d.talud);
    let l3 = 0;
    if (n === 3) {
      const fila = tablas.longitudRodillos.filas.find(f => f.B === B);
      if (!fila || fila.tres === null) return null;
      l3 = fila.tres / 1000;
    }
    return Math.pow(l3 + (b - l3) * Math.cos(lambda), 2) * Math.tan(talud) / 6
         + (l3 + (b - l3) / 2 * Math.cos(lambda)) * ((b - l3) / 2 * Math.sin(lambda));
  }
  if (d.metodoSeccion === "tabla") {
    const t = tablas.capacidadRulmeca;
    const porAncho = t.datos[String(B)];
    const fila = porAncho ? porAncho[String(d.talud)] : null;
    const iL = t.lambdas.indexOf(Number(d.lambda));
    return fila && iL >= 0 ? fila[iL] / 3600 : null;
  }
  return d.Sdirecta;
}

/**
 * Calcula todo el dimensionado.
 * @param {object} d  Datos de entrada (mismos nombres que los campos del formulario).
 * @param {object} tablas  Contenido de tablas.json.
 * @returns {object} { valores, secciones, avisos }
 *   valores: resultados numéricos por clave (para el resumen y la comparación).
 *   secciones: filas de resultados que se muestran en cada paso.
 *   avisos: comprobaciones (tipo "ok", "mal" o "info") por paso.
 */
function calcular(d, tablas) {
  const g = tablas.gravedad;
  const valores = {};
  const secciones = { geometria: [], capacidad: [], resistencias: [], potencia: [], tensiones: [], capas: [], separacion: [] };
  const avisos = { geometria: [], capacidad: [], resistencias: [], potencia: [], tensiones: [], capas: [], separacion: [] };

  // Añade un resultado a una sección.
  function res(sec, clave, etiqueta, valor, unidad, dec, formula) {
    if (clave) valores[clave] = valor;
    secciones[sec].push({ etiqueta, valor, unidad, dec, formula });
  }
  const aviso = (sec, tipo, texto) => avisos[sec].push({ tipo, texto });

  // --- Geometría e inclinación ---------------------------------------------
  const L = d.L;
  let delta, H;
  if (d.modoIncl === "angulo") {
    delta = aRad(d.anguloDeg);
    H = L * Math.sin(delta);
  } else {
    H = d.H;
    if (Math.abs(H) > L) {
      aviso("geometria", "mal", "El desnivel H no puede ser mayor que la longitud L.");
      H = Math.sign(H) * L;
    }
    delta = Math.asin(H / L);
  }
  const deltaDeg = aGrados(delta);
  const cosd = Math.cos(delta);
  res("geometria", "deltaDeg", "Inclinación δ", deltaDeg, "°", 2,
    d.modoIncl === "angulo" ? "dato" : `δ = arcsen(H/L) = arcsen(${fmt(H, 2)} / ${fmt(L, 2)})`);
  res("geometria", "H", "Desnivel H", H, "m", 2, d.modoIncl === "angulo" ? `H = L · sen δ` : "dato");
  // Material de la tabla: inclinación máxima admisible en banda.
  const docMat = tablas.materiales;
  const mat = d.material && docMat ? docMat.materiales.find(m => m.id === d.material) : null;
  if (mat && mat.inclinacionMax) {
    const dmax = mat.inclinacionMax[0];
    if (Math.abs(deltaDeg) <= dmax) aviso("geometria", "ok", `Inclinación ${fmt(Math.abs(deltaDeg), 2)}° ≤ ${fmt(dmax, 0)}°, máxima en banda para ${mat.nombre}${mat.estado ? " (" + mat.estado + ")" : ""}.`);
    else aviso("geometria", "mal", `Inclinación ${fmt(Math.abs(deltaDeg), 2)}° > ${fmt(dmax, 0)}°, máxima en banda para ${mat.nombre}: el material rodaría hacia atrás. Reduce la pendiente o usa una banda con perfiles.`);
  }
  if (Math.abs(deltaDeg) > 5) {
    aviso("geometria", "info", "Con más de 5° de inclinación conviene una zona de carga horizontal bajo la tolva.");
  }
  if (Math.abs(deltaDeg) >= 18) {
    aviso("geometria", "info", "Con δ ≥ 18° ya no puede tomarse cos δ ≈ 1 (ISO 5048). La aplicación usa siempre el coseno real.");
  }

  // --- Ajuste por caudal: el caudal pedido fija la velocidad o el ancho ------
  valores.QmaxAjuste = null;
  if (d.modoQg === "caudal" && (d.ajusteCaudal === "velocidad" || d.ajusteCaudal === "ancho")) {
    const Q = Math.max(0, d.Qdato ?? 0);
    const tK0 = tablas.factorInclinacion, inc0 = Math.abs(deltaDeg);
    const K0 = inc0 <= tK0.angulos[0] ? 1 : interpolar(tK0.angulos, tK0.K, inc0);
    const capacidadCon = (B, v) => {
      const S = seccionMaterial(B, d, tablas);
      return S > 0 ? 3.6 * v * S * d.rho * K0 : null;
    };
    if (d.ajusteCaudal === "velocidad") {
      const vels = tablas.velocidadesNormalizadas.valores;
      const Q1 = capacidadCon(d.B, 1);   // capacidad a 1 m/s con el ancho actual
      if (Q1 === null) {
        aviso("capacidad", "mal", `No se puede ajustar la velocidad: la sección no está definida para B = ${d.B} mm.`);
      } else {
        const vNec = Q / Q1;
        valores.QmaxAjuste = Q1 * vels[vels.length - 1];
        res("capacidad", "vNec", "Velocidad necesaria", vNec, "m/s", 3, `v = Q / (3,6·S·ρ·K) = ${fmt(Q, 1)} / ${fmt(Q1, 1)}`);
        let vAd = vels.find(x => x >= vNec - 1e-9);
        if (vAd === undefined) {
          vAd = vNec;
          aviso("capacidad", "mal", `Hace falta v = ${fmt(vNec, 2)} m/s, más que la máxima normalizada (${fmt(vels[vels.length - 1], 2)} m/s). Sube el ancho B o el ángulo de terna.`);
        } else {
          aviso("capacidad", "info", `Velocidad ajustada al caudal: se adopta la normalizada DIN inmediatamente superior a ${fmt(vNec, 3)} m/s.`);
        }
        res("capacidad", "vAdoptada", "Velocidad adoptada v", vAd, "m/s", 2, "DIN 22101, igual o superior a la necesaria");
        d = { ...d, v: vAd };
      }
    } else if (d.metodoSeccion === "directa") {
      aviso("capacidad", "mal", "Con «Sección conocida» la sección no depende del ancho: elige el cálculo geométrico o la tabla Rulmeca para ajustar B.");
    } else {
      const candidatos = tablas.anchosBanda.filter(B => capacidadCon(B, d.v) !== null);
      if (!candidatos.length) {
        aviso("capacidad", "mal", "No hay ningún ancho con datos de sección para estos rodillos y ángulos.");
      } else {
        const mayor = candidatos[candidatos.length - 1];
        valores.QmaxAjuste = capacidadCon(mayor, d.v);
        let BAd = candidatos.find(B => capacidadCon(B, d.v) >= Q - 1e-9);
        if (BAd === undefined) {
          BAd = mayor;
          aviso("capacidad", "mal", `Ni con B = ${mayor} mm se alcanzan ${fmt(Q, 1)} t/h a ${fmt(d.v, 2)} m/s (máx. ${fmt(valores.QmaxAjuste, 1)} t/h). Sube la velocidad.`);
        } else {
          aviso("capacidad", "info", `Ancho ajustado al caudal: el menor ancho normalizado con capacidad suficiente a ${fmt(d.v, 2)} m/s.`);
        }
        res("capacidad", "BAdoptado", "Ancho adoptado B", BAd, "mm", 0, `capacidad con ese ancho: ${fmt(capacidadCon(BAd, d.v), 1)} t/h`);
        d = { ...d, B: BAd };
      }
    }
  }
  valores.v = d.v;
  valores.B = Number(d.B);

  // --- 1. Capacidad de transporte ------------------------------------------
  if (mat) {
    const pm = propiedadesMaterial(mat, docMat);
    const r2 = x => x ? (x[0] === x[1] ? fmt(x[0], 0) : `${fmt(x[0], 0)}–${fmt(x[1], 0)}`) : "—";
    const den = mat.densidad ? (mat.densidad[0] === mat.densidad[1] ? fmt(mat.densidad[0], 2) : `${fmt(mat.densidad[0], 2)}–${fmt(mat.densidad[1], 2)}`) : "—";
    aviso("capacidad", "info", `${mat.nombre}${mat.estado ? " (" + mat.estado + ")" : ""}: peso específico ${den} t/m³, reposo α = ${r2(mat.reposo)}°, inclinación máx. ${r2(mat.inclinacionMax)}°, fluidez ${pm.fluidez || "—"}${mat.otras ? ", " + mat.otras.toLowerCase() : ""}.`);
    if (mat.densidad && (d.rho < mat.densidad[0] * 1000 - 1 || d.rho > mat.densidad[1] * 1000 + 1)) {
      aviso("capacidad", "mal", `ρ = ${fmt(d.rho, 0)} kg/m³ está fuera del intervalo de la tabla (${den} t/m³).`);
    }
    if (pm.beta !== null && Number(d.talud) !== pm.beta) {
      aviso("capacidad", "info", `La tabla sugiere β = ${pm.beta}° (${pm.origenBeta}); estás usando ${fmt(d.talud, 0)}°.`);
    }
    if (pm.clase && d.claseMaterial && d.claseMaterial !== pm.clase) {
      aviso("capacidad", "info", `Por peso específico y abrasividad, la clase sugerida en la Tabla 1.3 es ${pm.clase}; has elegido ${d.claseMaterial}.`);
    }
  }
  const Bm = d.B / 1000;
  const b = Bm <= 2 ? 0.9 * Bm - 0.05 : Bm - 0.2;
  let S = null;

  if (d.metodoSeccion === "geometrico") {
    const n = Number(d.nRodillos);
    const lambda = n === 1 ? 0 : aRad(d.lambda);
    const talud = aRad(d.talud);
    let l3 = 0;
    if (n === 3) {
      const fila = tablas.longitudRodillos.filas.find(f => f.B === Number(d.B));
      if (!fila || fila.tres === null) {
        aviso("capacidad", "mal", `No hay estación de 3 rodillos para B = ${d.B} mm en la Figura 1.1. Elige otro ancho o 1–2 rodillos.`);
      } else {
        l3 = fila.tres / 1000;
      }
    }
    const S1 = Math.pow(l3 + (b - l3) * Math.cos(lambda), 2) * Math.tan(talud) / 6;
    const S2 = (l3 + (b - l3) / 2 * Math.cos(lambda)) * ((b - l3) / 2 * Math.sin(lambda));
    S = S1 + S2;
    res("capacidad", "b", "Anchura útil b", b, "m", 3, Bm <= 2 ? `b = 0,9·B − 0,05 = 0,9·${fmt(Bm, 3)} − 0,05` : `b = B − 0,2`);
    res("capacidad", "l3", "Rodillo central l₃", l3, "m", 3, n === 3 ? "Figura 1.1 (3 rodillos)" : "l₃ = 0 con 1 o 2 rodillos");
    res("capacidad", "S1", "Sección superior S₁", S1, "m²", 5, "S₁ = [l₃ + (b − l₃)·cos λ]² · tg β / 6");
    res("capacidad", "S2", "Sección trapecial S₂", S2, "m²", 5, "S₂ = [l₃ + (b − l₃)/2·cos λ] · [(b − l₃)/2·sen λ]");
    res("capacidad", "S", "Sección total S", S, "m²", 5, "S = S₁ + S₂");
    valores._geo = { b, l3, lambda, talud, n };
  } else if (d.metodoSeccion === "tabla") {
    const t = tablas.capacidadRulmeca;
    const porAncho = t.datos[String(d.B)];
    const iL = t.lambdas.indexOf(Number(d.lambda));
    const fila = porAncho ? porAncho[String(d.talud)] : null;
    if (!porAncho || !fila || iL < 0) {
      aviso("capacidad", "mal", `La tabla Rulmeca solo cubre B = 300, 400, 500 mm; β = ${t.betas.join(", ")}°; λ = ${t.lambdas.join(", ")}°.`);
    } else {
      const Qv1 = fila[iL];
      S = Qv1 / 3600;
      res("capacidad", "Qv1", "Caudal a 1 m/s (tabla)", Qv1, "m³/h", 1, `Rulmeca, B = ${d.B} mm, β = ${d.talud}°, λ = ${d.lambda}°`);
      res("capacidad", "S", "Sección equivalente S", S, "m²", 5, "S = Qv(1 m/s) / 3600");
    }
  } else {
    S = d.Sdirecta;
    res("capacidad", "S", "Sección S", S, "m²", 5, "dato");
  }

  // Factor de inclinación K (Tabla 1.1), interpolado.
  const tK = tablas.factorInclinacion;
  const incl = Math.abs(deltaDeg);
  const K = incl <= tK.angulos[0] ? 1 : interpolar(tK.angulos, tK.K, incl);
  if (incl > 20) aviso("capacidad", "mal", "La inclinación supera los 20° de la Tabla 1.1: se toma K = 0,81, pero el material podría deslizar.");

  let qgCap = null;
  if (S !== null && S > 0) {
    const Qv = S * d.v * 3600;
    const Qm = Qv * d.rho / 1000 * K;
    qgCap = S * d.rho * K;
    res("capacidad", "K", "Factor de inclinación K", K, "", 3, `Tabla 1.1 para ${fmt(incl, 2)}°`);
    res("capacidad", "Qv", "Caudal volumétrico", Qv, "m³/h", 1, `Qv = 3600 · S · v = 3600 · ${fmt(S, 5)} · ${fmt(d.v, 2)}`);
    res("capacidad", "Qm", "Capacidad Q", Qm, "t/h", 1, `Q = 3,6 · v · S · ρ · K = 3,6 · ${fmt(d.v, 2)} · ${fmt(S, 5)} · ${fmt(d.rho, 0)} · ${fmt(K, 3)}`);
    res("capacidad", "qgCap", "Carga lineal resultante", qgCap, "kg/m", 2, "q_g = S · ρ · K");
  }

  // Comprobación con la Tabla 1.3 (velocidad máxima y tamaño de fragmento).
  if (d.claseMaterial) {
    const filas = tablas.velocidadesMaximas.filas.filter(f => f.B <= Number(d.B));
    if (filas.length === 0) {
      aviso("capacidad", "info", "La Tabla 1.3 empieza en 400 mm; no se puede comprobar la velocidad máxima.");
    } else {
      const fila = filas[filas.length - 1];
      const vmax = fila[d.claseMaterial === "B" ? "B_" : d.claseMaterial];
      if (d.v <= vmax) aviso("capacidad", "ok", `v = ${fmt(d.v, 2)} m/s ≤ ${fmt(vmax, 2)} m/s (máxima para material ${d.claseMaterial} y B = ${fila.B} mm).`);
      else aviso("capacidad", "mal", `v = ${fmt(d.v, 2)} m/s supera la máxima de ${fmt(vmax, 2)} m/s para material ${d.claseMaterial} y B = ${fila.B} mm.`);
      if (d.tamano > 0) {
        const tmax = fila[d.tipoTamano];
        if (d.tamano <= tmax) aviso("capacidad", "ok", `Tamaño de ${fmt(d.tamano, 0)} mm ≤ ${tmax} mm admitido (${d.tipoTamano}).`);
        else aviso("capacidad", "mal", `Tamaño de ${fmt(d.tamano, 0)} mm > ${tmax} mm admitido para B = ${fila.B} mm (${d.tipoTamano}). Hace falta una banda más ancha.`);
      }
    }
  }
  if (!tablas.velocidadesNormalizadas.valores.includes(Number(d.v))) {
    aviso("capacidad", "info", `${fmt(d.v, 2)} m/s no es una velocidad normalizada DIN 22101 (${tablas.velocidadesNormalizadas.valores.map(x => fmt(x, 2)).join(" · ")}).`);
  }

  // Carga lineal del material: dato, calculada con la capacidad o con el caudal pedido.
  let qg = d.qg;
  if (d.modoQg === "capacidad") {
    if (qgCap === null) aviso("resistencias", "mal", "No se puede calcular q_g desde la capacidad: revisa el paso 1.");
    qg = qgCap ?? 0;
  } else if (d.modoQg === "caudal") {
    const Q = d.Qdato ?? 0;
    if (d.v > 0) {
      qg = Q / (3.6 * d.v);
      res("capacidad", "Qdato", "Caudal pedido Q", Q, "t/h", 1, "dato");
      res("capacidad", "qgCaudal", "Carga lineal con el caudal pedido", qg, "kg/m", 2, `q_g = Q / (3,6·v) = ${fmt(Q, 1)} / (3,6·${fmt(d.v, 2)})`);
    } else {
      qg = 0;
      aviso("capacidad", "mal", "Con v = 0 no se puede pasar el caudal a carga lineal.");
    }
    if (Q < 0) aviso("capacidad", "mal", "El caudal no puede ser negativo.");
    if (qgCap !== null && Q >= 0) {
      const uso = valores.Qm > 0 ? Q / valores.Qm * 100 : null;
      if (qg <= qgCap + 1e-9) aviso("capacidad", "ok", `Caudal pedido ${fmt(Q, 1)} t/h ≤ capacidad máxima ${fmt(valores.Qm, 1)} t/h (llenado ${fmt(uso, 1)} %).`);
      else aviso("capacidad", "mal", `Caudal pedido ${fmt(Q, 1)} t/h > capacidad máxima ${fmt(valores.Qm, 1)} t/h (llenado ${fmt(uso, 1)} %). Sube la velocidad, el ancho B o el ángulo de terna λ.`);
    }
  }

  // Caudal que realmente transporta la cinta con esa carga lineal.
  valores.Qreal = qg * d.v * 3.6;
  if (d.modoQg === "manual" && qgCap !== null) {
    if (qg <= qgCap + 1e-9) aviso("resistencias", "ok", `q_g = ${fmt(qg, 2)} kg/m equivale a ${fmt(valores.Qreal, 1)} t/h, dentro de la capacidad máxima de ${fmt(valores.Qm, 1)} t/h (paso 2).`);
    else aviso("resistencias", "mal", `q_g = ${fmt(qg, 2)} kg/m equivale a ${fmt(valores.Qreal, 1)} t/h y supera la capacidad máxima de ${fmt(valores.Qm, 1)} t/h calculada en el paso 2.`);
  }

  // --- 2. Resistencias al movimiento ----------------------------------------
  let Fu;
  if (d.modoFu === "calculo") {
    const metodo = d.metodo === "auto" ? (L > 80 ? "simplificado" : "global") : d.metodo;
    const qTot = d.qR + (2 * d.qb + qg) * cosd;
    const textoQ = `[${fmt(d.qR, 2)} + (2·${fmt(d.qb, 2)} + ${fmt(qg, 2)})·cos ${fmt(deltaDeg, 2)}°]`;
    if (d.modoQg === "capacidad") res("resistencias", "qg", "Carga del material q_g", qg, "kg/m", 2, "del paso 2 (capacidad)");
    else if (d.modoQg === "caudal") res("resistencias", "qg", "Carga del material q_g", qg, "kg/m", 2, "del paso 2 (caudal pedido)");
    let FHFN;
    if (metodo === "global") {
      const FH = d.f * L * g * qTot;
      const mPunto = qg * d.v;
      const FNacc = mPunto * (d.v - d.v0);
      const FN = FNacc + d.FNtamb;
      FHFN = FH + FN;
      res("resistencias", "FH", "Principales FH", FH, "N", 2, `FH = f·L·g·[q_R + (2q_b + q_g)cos δ] = ${fmt(d.f, 3)}·${fmt(L, 1)}·${fmt(g, 2)}·${textoQ}`);
      res("resistencias", "FNacc", "Aceleración del material", FNacc, "N", 2, `F = ṁ·(v − v₀) = ${fmt(mPunto, 2)}·(${fmt(d.v, 2)} − ${fmt(d.v0, 2)})`);
      res("resistencias", "FN", "Secundarias FN", FN, "N", 2, `FN = ${fmt(FNacc, 2)} + ${fmt(d.FNtamb, 2)} (tambores no motrices)`);
      aviso("resistencias", "info", `Método global (suma individual de resistencias)${d.metodo === "auto" ? ", elegido porque L ≤ 80 m" : ""}.`);
      if (L > 80) aviso("resistencias", "info", "Para L > 80 m y una sola alimentación suele usarse el método simplificado con el coeficiente C.");
    } else {
      const C = d.modoC === "tabla" ? interpolar(tablas.factorLongitud.L, tablas.factorLongitud.C, L) : d.C;
      const LC = C * L;
      FHFN = d.f * LC * g * qTot;
      res("resistencias", "C", "Coeficiente C", C, "", 3, d.modoC === "tabla" ? `tabla C(L) interpolada para L = ${fmt(L, 1)} m` : "dato");
      res("resistencias", "LC", "Longitud corregida LC", LC, "m", 2, `LC = C·L = ${fmt(C, 3)}·${fmt(L, 1)}`);
      res("resistencias", "FHFN", "Principales + secundarias", FHFN, "N", 2, `FH + FN ≃ f·LC·g·[q_R + (2q_b + q_g)cos δ] = ${fmt(d.f, 3)}·${fmt(LC, 2)}·${fmt(g, 2)}·${textoQ}`);
      aviso("resistencias", "info", `Método simplificado (longitud corregida)${d.metodo === "auto" ? ", elegido porque L > 80 m" : ""}. Las resistencias secundarias van incluidas en C.`);
      if (L <= 80) aviso("resistencias", "mal", "El método simplificado es apropiado para L > 80 m. Con cintas cortas conviene el método global.");
    }
    const FSt = qg * g * H;
    res("resistencias", "FSt", "Elevación FSt", FSt, "N", 2, `FSt = q_g·g·H = ${fmt(qg, 2)}·${fmt(g, 2)}·${fmt(H, 2)}`);
    res("resistencias", "FS", "Especiales FS1 + FS2", d.FS1 + d.FS2, "N", 2, `${fmt(d.FS1, 2)} + ${fmt(d.FS2, 2)}`);
    Fu = FHFN + d.FS1 + d.FS2 + FSt;
    res("resistencias", "Fu", "Fuerza periférica Fu", Fu, "N", 2, "Fu = FH + FN + FS1 + FS2 + FSt");
    valores.metodo = metodo;
  } else if (d.modoFu === "directa") {
    Fu = d.FuDirecta;
    res("resistencias", "Fu", "Fuerza periférica Fu", Fu, "N", 2, "dato");
  } else {
    Fu = d.Pdato * 1000 / d.v;
    res("resistencias", "Fu", "Fuerza periférica Fu", Fu, "N", 2, `Fu = P / v = ${fmt(d.Pdato * 1000, 0)} / ${fmt(d.v, 2)}`);
  }

  const FuValida = Number.isFinite(Fu) && Fu > 0;
  if (!FuValida) {
    aviso("resistencias", "mal", "Fu ≤ 0: la gravedad arrastra la cinta (transporte descendente). Hace falta freno o recuperación de energía; el resto del cálculo no aplica.");
  }

  // --- 3. Potencia y accionamiento -----------------------------------------
  const r = d.D / 2000;
  if (FuValida) {
    const Pu = Fu * d.v / 1000;
    const Pmotor = Pu / d.eta;
    res("potencia", "Pu", "Potencia útil en el tambor", Pu, "kW", 2, `Pu = Fu·v = ${fmt(Fu, 2)}·${fmt(d.v, 2)}`);
    res("potencia", "Pmotor", "Potencia en el eje del motor", Pmotor, "kW", 2, `P = Pu / η = ${fmt(Pu, 3)} / ${fmt(d.eta, 2)}`);
    res("potencia", "M", "Par en el tambor", Fu * r, "N·m", 2, `M = Fu·r = ${fmt(Fu, 2)}·${fmt(r, 3)}`);
  }
  const omega = d.v / r;
  res("potencia", "omega", "Velocidad angular ω", omega, "rad/s", 2, `ω = v / r = ${fmt(d.v, 2)} / ${fmt(r, 3)}`);
  res("potencia", "n", "Velocidad de giro n", omega * 60 / (2 * Math.PI), "rpm", 1, "n = 60·ω / 2π");

  // --- 4. Tensiones: adherencia y flecha -----------------------------------
  const theta = aRad(d.theta);
  const k = Math.exp(d.mu * theta);
  const hr = d.hrelMax / 100;
  const qSup = d.qb + qg;
  const qInf = d.qb;

  res("tensiones", "k", "Factor de Euler–Eytelwein", k, "", 4, `e^(μθ) = e^(${fmt(d.mu, 3)}·${fmt(theta, 4)})`);

  // Separación de rodillos automática: artesas (ramal portante) y retorno.
  // Se parte de la T2 que da la adherencia (+ margen) o de la T2 escrita:
  //   l_máx = 8·T2·h_rel / (q·g·cos δ), redondeada a 5 cm y dentro de lo habitual
  //   (artesas 1–1,5 m; retorno 2–3 veces la de artesas y como mucho 3 m).
  const T2adh = FuValida ? Fu / (k - 1) : null;
  const multiplo5 = l => Math.floor(l / 0.05 + 1e-9) * 0.05;
  const qnSup = qSup * g * cosd, qnInf = qInf * g * cosd;
  const sepAuto = d.modoSep !== "dato";
  if (sepAuto) {
    const T2base = d.T2 ?? (T2adh !== null ? T2adh * (1 + d.margen / 100) : null);
    let lS = 1.2, lI = 3;
    if (T2base > 0 && hr > 0) {
      const lSmax = qnSup > 0 ? 8 * T2base * hr / qnSup : Infinity;
      const lImax = qnInf > 0 ? 8 * T2base * hr / qnInf : Infinity;
      lS = Math.round(Math.min(1.5, Math.max(1.0, multiplo5(lSmax))) * 100) / 100;
      lI = Math.round(Math.max(2 * lS, Math.min(3 * lS, 3.0, multiplo5(lImax))) * 100) / 100;
      if (lSmax < 1) aviso("separacion", "info", `Con la T2 de adherencia (${fmt(T2base, 0)} N) la flecha pediría artesas a ${fmt(lSmax, 2)} m; se ponen a 1,00 m (mínimo habitual) y T2 sube por el criterio de flecha.`);
      else if (lSmax > 1.5) aviso("separacion", "info", `Por flecha cabrían artesas a ${fmt(lSmax, 2)} m; se limitan a 1,50 m (máximo habitual por la carga en los rodillos).`);
    }
    d = { ...d, lRsup: lS, lRinf: lI };
  }

  const TsupMin = qSup * g * cosd * d.lRsup / (8 * hr);
  const TinfMin = qInf * g * cosd * d.lRinf / (8 * hr);
  valores.TsupMin = TsupMin;
  valores.TinfMin = TinfMin;

  let T2 = null, T1 = null;
  if (FuValida) {
    res("tensiones", "T2adh", "T2 mínima por adherencia", T2adh, "N", 2, `T2 ≥ Fu / (e^(μθ) − 1) = ${fmt(Fu, 2)} / ${fmt(k - 1, 4)}`);

    // Tensión mínima de diseño (4.12). El ramal de retorno sale del tambor con T2;
    // si no se da la tensión local del ramal portante, se supone también T2 (criterio conservador).
    const T2flecha = d.Tsup === null ? Math.max(TinfMin, TsupMin) : TinfMin;
    const T2minDis = Math.max(T2adh, T2flecha);
    res("tensiones", "T2minDis", "T2 mínima de diseño", T2minDis, "N", 2, "máx(T2 adherencia, T2 flecha)");

    if (d.T2 === null) {
      T2 = T2minDis * (1 + d.margen / 100);
      res("tensiones", "T2", "T2 adoptada", T2, "N", 2, `T2 mín · (1 + ${fmt(d.margen, 0)} %)`);
    } else {
      T2 = d.T2;
      res("tensiones", "T2", "T2 adoptada", T2, "N", 2, "dato");
    }
    T1 = T2 + Fu;
    const ratio = T1 / T2;
    const FuMaxAdh = T2 * (k - 1);
    const reserva = (FuMaxAdh / Fu - 1) * 100;
    const thetaMin = aGrados(Math.log(Fu / T2 + 1) / d.mu);
    res("tensiones", "T1", "T1 (ramal tenso)", T1, "N", 2, `T1 = T2 + Fu = ${fmt(T2, 2)} + ${fmt(Fu, 2)}`);
    res("tensiones", "ratio", "Relación T1 / T2", ratio, "", 4, `límite e^(μθ) = ${fmt(k, 4)}`);
    res("tensiones", "FuMaxAdh", "Fu máxima por adherencia", FuMaxAdh, "N", 2, `T2·(e^(μθ) − 1) = ${fmt(T2, 2)}·${fmt(k - 1, 4)}`);
    res("tensiones", "reserva", "Reserva frente a deslizamiento", reserva, "%", 1, "Fu,máx / Fu − 1");
    res("tensiones", "thetaMin", "Ángulo mínimo con esta T2", thetaMin, "°", 1, `θ = ln(Fu/T2 + 1) / μ`);

    if (ratio <= k + 1e-9) {
      aviso("tensiones", reserva < 5 ? "info" : "ok", `Adherencia: T1/T2 = ${fmt(ratio, 3)} ≤ ${fmt(k, 3)}${reserva < 5 ? " pero la reserva es muy pequeña; no conviene trabajar en el límite." : "."}`);
    } else {
      aviso("tensiones", "mal", `La cinta patina: T1/T2 = ${fmt(ratio, 3)} > ${fmt(k, 3)}. Sube T2 hasta ${fmt(T2adh, 0)} N o el ángulo hasta ${fmt(thetaMin, 1)}° (tambor de reenvío).`);
    }
    if (d.T2 !== null && d.T2 < TinfMin) {
      aviso("tensiones", "mal", `T2 = ${fmt(T2, 0)} N es menor que la tensión mínima por flecha del retorno (${fmt(TinfMin, 0)} N).`);
    }
    if (d.T1adm !== null) {
      if (T1 <= d.T1adm) aviso("tensiones", "ok", `T1 = ${fmt(T1, 2)} N ≤ ${fmt(d.T1adm, 0)} N admisible.`);
      else aviso("tensiones", "mal", `T1 = ${fmt(T1, 2)} N supera los ${fmt(d.T1adm, 0)} N admisibles.`);
    }
  }

  // Flecha con las tensiones locales (o T2 si no se dan).
  const Tsup = d.Tsup ?? T2;
  const Tinf = d.Tinf ?? T2;
  res("tensiones", "TsupMin", "T mínima ramal portante", TsupMin, "N", 2,
    `(q_b + q_g)·g·cos δ·l_R / (8·h_rel) = ${fmt(qSup, 2)}·${fmt(g, 2)}·${fmt(cosd, 4)}·${fmt(d.lRsup, 2)} / (8·${fmt(hr, 3)})`);
  res("tensiones", "TinfMin", "T mínima ramal de retorno", TinfMin, "N", 2,
    `q_b·g·cos δ·l_R / (8·h_rel) = ${fmt(qInf, 2)}·${fmt(g, 2)}·${fmt(cosd, 4)}·${fmt(d.lRinf, 2)} / (8·${fmt(hr, 3)})`);

  function flecha(rama, q, lR, T, origen) {
    if (T === null || !(T > 0)) return;
    const h = q * g * cosd * lR * lR / (8 * T) * 1000;
    const hrel = h / (lR * 1000) * 100;
    const lmax = q > 0 ? 8 * T * hr / (q * g * cosd) : null;
    const claveH = rama === "portante" ? "hsup" : "hinf";
    const claveR = rama === "portante" ? "hrelSup" : "hrelInf";
    const claveL = rama === "portante" ? "lRsupMax" : "lRinfMax";
    res("tensiones", claveH, `Flecha ramal ${rama}`, h, "mm", 2, `h = q·g·cos δ·l_R² / (8T), con T = ${fmt(T, 0)} N (${origen})`);
    res("tensiones", claveR, `Flecha relativa ${rama}`, hrel, "%", 3, "h / l_R");
    res("tensiones", claveL, `Separación máxima ${rama}`, lmax, "m", 3, `l_R,máx = 8·T·h_rel / (q·g·cos δ)`);
    if (hrel <= d.hrelMax + 1e-9) aviso("tensiones", "ok", `Flecha del ramal ${rama}: ${fmt(hrel, 2)} % ≤ ${fmt(d.hrelMax, 2)} %.`);
    else aviso("tensiones", "mal", `Flecha del ramal ${rama}: ${fmt(hrel, 2)} % > ${fmt(d.hrelMax, 2)} %. Aumenta la tensión o acerca los rodillos (máx. ${fmt(lmax, 2)} m).`);
  }
  flecha("portante", qSup, d.lRsup, Tsup, d.Tsup === null ? "se toma T2" : "tensión local");
  flecha("retorno", qInf, d.lRinf, Tinf, d.Tinf === null ? "se toma T2" : "tensión local");

  // --- Separación entre rodillos (paso 7) ----------------------------------
  if (T2 > 0 && hr > 0) {
    if (qnSup > 0) {
      res("separacion", "lCola", "Separación máx. de artesas en cola (T ≈ T2)", 8 * T2 * hr / qnSup, "m", 3,
        `8·T2·h_rel / [(q_b + q_g)·g·cos δ] = 8·${fmt(T2, 0)}·${fmt(hr, 3)} / ${fmt(qnSup, 2)}`);
      res("separacion", "lCabeza", "Separación máx. de artesas en cabeza (T ≈ T1)", 8 * T1 * hr / qnSup, "m", 3,
        `8·T1·h_rel / [(q_b + q_g)·g·cos δ] = 8·${fmt(T1, 0)}·${fmt(hr, 3)} / ${fmt(qnSup, 2)}`);
    }
    if (qnInf > 0) {
      res("separacion", "lRet", "Separación máx. de retorno (T ≈ T2)", 8 * T2 * hr / qnInf, "m", 3,
        `8·T2·h_rel / (q_b·g·cos δ) = 8·${fmt(T2, 0)}·${fmt(hr, 3)} / ${fmt(qnInf, 2)}`);
    }
  }
  res("separacion", "lRsupAd", "Separación entre artesas adoptada", d.lRsup, "m", 2,
    sepAuto ? "automática: múltiplo de 5 cm entre 1 y 1,5 m" : "dato (paso 5)");
  res("separacion", "lRinfAd", "Separación de los rodillos de retorno", d.lRinf, "m", 2,
    sepAuto ? "automática: 2 a 3 veces la de artesas, como mucho 3 m" : "dato (paso 5)");
  if (d.lRsup > 0) res("separacion", "nSup", "Estaciones de artesa (aprox.)", Math.ceil(L / d.lRsup), "", 0, `≈ L / l_R,sup = ${fmt(L, 1)} / ${fmt(d.lRsup, 2)}`);
  if (d.lRinf > 0) res("separacion", "nInf", "Rodillos de retorno (aprox.)", Math.ceil(L / d.lRinf), "", 0, `≈ L / l_R,inf = ${fmt(L, 1)} / ${fmt(d.lRinf, 2)}`);
  valores._vano = null;
  if (T2 > 0 && d.lRsup > 0) {
    const hC = qnSup * d.lRsup * d.lRsup / (8 * T2);
    res("separacion", "hCola", "Flecha entre artesas en cola", hC * 1000, "mm", 1, `h = q·l² / (8·T2) = ${fmt(qnSup, 2)}·${fmt(d.lRsup, 2)}² / (8·${fmt(T2, 0)})`);
    res("separacion", "hrelCola", "Flecha relativa en cola", hC / d.lRsup * 100, "%", 2, `admisible ${fmt(d.hrelMax, 2)} %`);
    valores._vano = { l: d.lRsup, h: hC, T: T2 };
    if (hC / d.lRsup <= hr + 1e-9) aviso("separacion", "ok", `Con artesas a ${fmt(d.lRsup, 2)} m la flecha en cola (el tramo más desfavorable) es ${fmt(hC / d.lRsup * 100, 2)} % ≤ ${fmt(d.hrelMax, 2)} %.`);
    else aviso("separacion", "mal", `Con artesas a ${fmt(d.lRsup, 2)} m la flecha en cola es ${fmt(hC / d.lRsup * 100, 2)} % > ${fmt(d.hrelMax, 2)} %: hace falta más T2 o acercar las artesas.`);
  } else {
    aviso("separacion", "info", "Sin T2 no se puede comprobar la flecha (revisa los pasos 3 y 5).");
  }

  // Recomendaciones constructivas (Cintas transportadoras II).
  if (d.lRsup < 1 || d.lRsup > 1.5) {
    aviso("tensiones", "info", `Separación habitual de rodillos portantes: 1–1,5 m (tienes ${fmt(d.lRsup, 2)} m).`);
  }
  const relRet = d.lRinf / d.lRsup;
  if (relRet < 2 - 1e-9 || relRet > 3 + 1e-9) {
    aviso("tensiones", "info", `En el retorno los rodillos suelen ir al doble o triple de separación que en carga (ahora ${fmt(relRet, 2)} veces).`);
  }
  const Lbanda = 2 * L + Math.PI * d.D / 1000;
  res("tensiones", "Lbanda", "Longitud de banda aprox.", Lbanda, "m", 1, `≈ 2·L + π·D = 2·${fmt(L, 1)} + π·${fmt(d.D / 1000, 3)}`);
  res("tensiones", "carrera", "Recorrido del tensor (1 %)", Lbanda * 0.01 / 2, "m", 2, "la banda se alarga ≈ 1 % con el uso; el tambor tensor se desplaza la mitad");

  // --- 5. Número de capas --------------------------------------------------
  const Tmax = d.modoTmax === "T1" ? T1 : d.TmaxManual;
  if (Tmax !== null && Tmax > 0) {
    // Iteración: S depende de z y z depende de S.
    let Sseg = 11, zCalc = 0, z = 0, pasos = [];
    for (let i = 0; i < 10; i++) {
      zCalc = Sseg * Tmax / (d.R * d.B);
      z = Math.max(1, Math.ceil(zCalc - 1e-9));
      pasos.push(`S = ${Sseg} → z = ${fmt(zCalc, 3)}`);
      const nuevo = coefSeguridad(z, tablas);
      if (nuevo === Sseg) break;
      Sseg = nuevo;
    }
    const zAd = Math.max(z, d.zMin);
    const SAd = coefSeguridad(zAd, tablas);
    const Tadm = d.R * zAd * d.B / SAd;
    res("capas", "Tmax", "Tensión máxima de cálculo", Tmax, "N", 2, d.modoTmax === "T1" ? "Tmáx = T1" : "dato");
    res("capas", "zCalc", "Capas calculadas z", zCalc, "", 3, `z ≥ S·Tmáx / (R·B) = ${Sseg}·${fmt(Tmax, 2)} / (${fmt(d.R, 0)}·${fmt(d.B, 0)})`);
    res("capas", "z", "Capas adoptadas", zAd, "", 0, zAd > z ? `mínimo constructivo (${d.zMin})` : "entero superior");
    res("capas", "Sseg", "Coeficiente de seguridad S", SAd, "", 0, "Tabla 4.1 (DIN 22101)");
    res("capas", "Tadm", "Tensión admisible", Tadm, "N", 0, `Tadm = R·z·B / S = ${fmt(d.R, 0)}·${zAd}·${fmt(d.B, 0)} / ${SAd}`);
    if (pasos.length > 1) aviso("capas", "info", `Iteración del coeficiente: ${pasos.join("; ")}.`);
    if (Tmax <= Tadm) aviso("capas", "ok", `Tmáx = ${fmt(Tmax, 0)} N ≤ Tadm = ${fmt(Tadm, 0)} N (aprovechamiento ${fmt(Tmax / Tadm * 100, 1)} %).`);
    else aviso("capas", "mal", `Tmáx = ${fmt(Tmax, 0)} N > Tadm = ${fmt(Tadm, 0)} N.`);
    if (zAd > 9) aviso("capas", "info", "Muchas capas: valora una banda más ancha o un tejido más resistente (mayor R); también exige tambores de mayor diámetro.");
  } else {
    aviso("capas", "info", "No hay tensión máxima: calcula antes las tensiones o introdúcela a mano.");
  }

  valores.Fu = FuValida ? Fu : null;
  valores._dibujo = { L, H, deltaDeg, theta: d.theta, T1, T2, Fu: FuValida ? Fu : null, v: d.v, lRsup: d.lRsup,
                      qg, K, k, mu: d.mu, ratio: T1 && T2 ? T1 / T2 : null };
  return { valores, secciones, avisos };
}

// Permite probar el cálculo con Node (node pruebas.js). En el navegador no hace nada.
if (typeof module !== "undefined") module.exports = { calcular, fmt, interpolar, propiedadesMaterial, seccionMaterial };

// ----------------------------------------------------------------------------
// 2. INTERFAZ
// ----------------------------------------------------------------------------

if (typeof document !== "undefined") {
  // Cambiar este número al publicar: evita que el navegador use JSON antiguos en caché.
  const VERSION = "6";
  let tablas = null;
  let ejemplos = null;
  let ejemploActual = null;

  const $ = id => document.getElementById(id);
  const campos = () => Array.from(document.querySelectorAll("[data-campo]"));

  // Lee el formulario y devuelve el objeto de datos.
  function leerDatos() {
    const d = {};
    for (const el of campos()) {
      const id = el.id;
      if (el.tagName === "SELECT" && el.dataset.tipo !== "num") {
        d[id] = el.value;
      } else {
        const texto = String(el.value).replace(",", ".").trim();
        d[id] = texto === "" ? null : Number(texto);
      }
    }
    // Campos obligatorios vacíos → 0 (los opcionales se quedan en null).
    for (const el of campos()) {
      if (d[el.id] === null && !el.hasAttribute("data-opcional")) d[el.id] = 0;
    }
    return d;
  }

  // Escribe un conjunto de datos en el formulario.
  function escribirDatos(datos) {
    for (const el of campos()) {
      if (!(el.id in datos)) continue;
      const valor = datos[el.id];
      el.value = valor === null ? "" : String(valor);
    }
  }

  // Muestra u oculta campos según los selectores de modo (atributo data-si="campo=valor|valor").
  function actualizarVisibilidad() {
    document.querySelectorAll("[data-si]").forEach(el => {
      const condiciones = el.dataset.si.split("&");
      const visible = condiciones.every(c => {
        const [campo, valores] = c.split("=");
        return valores.split("|").includes($(campo).value);
      });
      el.hidden = !visible;
    });
  }

  function pintarSeccion(nombre, resultado) {
    const cont = $("res-" + nombre);
    if (!cont) return;
    cont.innerHTML = "";
    const lista = document.createElement("dl");
    lista.className = "lista-res";
    for (const fila of resultado.secciones[nombre]) {
      const dt = document.createElement("dt");
      dt.textContent = fila.etiqueta;
      const dd = document.createElement("dd");
      const valor = document.createElement("span");
      valor.className = "valor";
      valor.textContent = fmt(fila.valor, fila.dec) + (fila.unidad ? " " + fila.unidad : "");
      dd.appendChild(valor);
      if (fila.formula) {
        const f = document.createElement("small");
        f.textContent = fila.formula;
        dd.appendChild(f);
      }
      lista.append(dt, dd);
    }
    cont.appendChild(lista);
    const avisosSec = resultado.avisos[nombre];
    if (avisosSec.length) {
      const ul = document.createElement("ul");
      ul.className = "avisos";
      for (const a of avisosSec) {
        const li = document.createElement("li");
        li.className = "aviso-" + a.tipo;
        li.textContent = a.texto;
        ul.appendChild(li);
      }
      cont.appendChild(ul);
    }
  }

  function pintarResumen(v) {
    const datos = [
      ["Caudal transportado", v.Qreal, "t/h", 1],
      ["Fuerza periférica", v.Fu, "N", 0],
      ["Potencia motor", v.Pmotor, "kW", 2],
      ["T1 / T2", null, "", 0],
      ["Capas", v.z, "", 0]
    ];
    const cont = $("resumen");
    cont.innerHTML = "";
    for (const [etq, val, uni, dec] of datos) {
      const div = document.createElement("div");
      const span = document.createElement("span");
      span.textContent = etq;
      const b = document.createElement("strong");
      if (etq === "T1 / T2") {
        b.textContent = (v.T1 ? fmt(v.T1, 0) : "—") + " / " + (v.T2 ? fmt(v.T2, 0) : "—") + " N";
      } else {
        b.textContent = fmt(val ?? null, dec) + (uni && Number.isFinite(val) ? " " + uni : "");
      }
      div.append(span, b);
      cont.appendChild(div);
    }
  }

  // ---- Dibujo del esquema de la cinta en <canvas> --------------------------
  function colores() {
    const s = getComputedStyle(document.documentElement);
    const c = n => s.getPropertyValue(n).trim();
    return { tinta: c("--tinta"), suave: c("--tinta-suave"), banda: c("--banda"), acero: c("--acero"),
             material: c("--material"), linea: c("--linea"), mal: c("--mal"), ok: c("--ok"), fondo: c("--superficie") };
  }

  function prepararCanvas(canvas) {
    const ratio = window.devicePixelRatio || 1;
    const ancho = canvas.clientWidth;
    const alto = canvas.clientHeight;
    canvas.width = Math.round(ancho * ratio);
    canvas.height = Math.round(alto * ratio);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, ancho, alto);
    return { ctx, ancho, alto };
  }

  function flecha(ctx, x1, y1, x2, y2, color, grosor = 2) {
    const ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = grosor;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 10 * Math.cos(ang - 0.4), y2 - 10 * Math.sin(ang - 0.4));
    ctx.lineTo(x2 - 10 * Math.cos(ang + 0.4), y2 - 10 * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill();
  }

  function dibujarEsquema(dib) {
    const canvas = $("esquema");
    const { ctx, ancho, alto } = prepararCanvas(canvas);
    const c = colores();
    const estrecho = ancho < 520;
    const fuente = estrecho ? 11 : 13;
    ctx.font = `${fuente}px Barlow, system-ui, sans-serif`;

    // Ángulo dibujado: el real, limitado a ±22° para que quepa.
    const angDib = Math.max(-22, Math.min(22, dib.deltaDeg)) * Math.PI / 180;
    const R = estrecho ? 18 : 26;
    const margenX = estrecho ? 34 : 70;
    const margenDer = estrecho ? 92 : 120;   // deja sitio a la etiqueta de θ
    const largo = (ancho - margenX - margenDer) / Math.cos(angDib);
    const yCentro = alto * 0.55;
    const x0 = margenX, y0 = yCentro + Math.sin(angDib) * largo / 2;
    const x1 = x0 + Math.cos(angDib) * largo, y1 = yCentro - Math.sin(angDib) * largo / 2;
    const nx = Math.sin(angDib), ny = Math.cos(angDib); // normal "hacia abajo" a la banda

    // Rodillos de apoyo (ramal portante) y de retorno.
    ctx.fillStyle = c.acero;
    const nRod = estrecho ? 7 : 12;
    for (let i = 1; i < nRod; i++) {
      const t = i / nRod;
      const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      ctx.beginPath(); ctx.arc(px + nx * (R * 0 + 6), py + ny * 6 - 0, 4, 0, 2 * Math.PI); ctx.fill();
      if (i % 2 === 0) { ctx.beginPath(); ctx.arc(px + nx * (2 * R - 6), py + ny * (2 * R - 6), 4, 0, 2 * Math.PI); ctx.fill(); }
    }

    // Material sobre el ramal portante.
    ctx.fillStyle = c.material;
    const nMont = estrecho ? 9 : 16;
    for (let i = 0; i < nMont; i++) {
      const t = 0.06 + 0.82 * i / nMont;
      const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      const w = (x1 - x0) / nMont * 0.9;
      ctx.beginPath();
      ctx.moveTo(px - w / 2, py + Math.tan(angDib) * w / 2);
      ctx.quadraticCurveTo(px, py - (estrecho ? 14 : 20), px + w / 2, py - Math.tan(angDib) * w / 2);
      ctx.closePath(); ctx.fill();
    }

    // Banda: ramal superior y de retorno.
    ctx.strokeStyle = c.banda; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0 + nx * 2 * R, y0 + ny * 2 * R); ctx.lineTo(x1 + nx * 2 * R, y1 + ny * 2 * R); ctx.stroke();

    // Tambores. El de cabeza (derecha) es el motriz.
    const tamb = (cx, cy, motriz) => {
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI);
      ctx.fillStyle = motriz ? c.acero : c.fondo; ctx.fill();
      ctx.strokeStyle = c.banda; ctx.lineWidth = 4; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 2 * Math.PI); ctx.fillStyle = motriz ? c.fondo : c.banda; ctx.fill();
    };
    tamb(x0 + nx * R, y0 + ny * R, false);
    const cxM = x1 + nx * R, cyM = y1 + ny * R;
    tamb(cxM, cyM, true);

    // Arco del ángulo de abrazamiento θ alrededor del tambor motriz.
    const th = (dib.theta || 0) * Math.PI / 180;
    const inicio = -Math.PI / 2 - angDib;
    ctx.strokeStyle = c.mal; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(cxM, cyM, R + 9, inicio, inicio + th); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = c.mal; ctx.textAlign = "left";
    ctx.fillText(`θ = ${fmt(dib.theta, 0)}°`, cxM + R + 12, cyM + 4);

    // Flechas de tensión T1 (llega al tambor por arriba) y T2 (sale por abajo).
    const dx = Math.cos(angDib), dy = -Math.sin(angDib);
    const lf = estrecho ? 50 : 80;
    ctx.textAlign = "center";
    flecha(ctx, x1 - dx * (lf + 20), y1 - dy * (lf + 20) - 26, x1 - dx * 20, y1 - dy * 20 - 26, c.tinta);
    ctx.fillStyle = c.tinta;
    ctx.fillText(`T1 = ${dib.T1 ? fmt(dib.T1, 0) + " N" : "—"}`, x1 - dx * (lf / 2 + 20), y1 - dy * (lf / 2 + 20) - 34);
    const bx = x1 + nx * 2 * R, by = y1 + ny * 2 * R;
    flecha(ctx, bx - dx * 20, by - dy * 20 + 14, bx - dx * (lf + 20), by - dy * (lf + 20) + 14, c.suave);
    ctx.fillStyle = c.suave;
    ctx.fillText(`T2 = ${dib.T2 ? fmt(dib.T2, 0) + " N" : "—"}`, bx - dx * (lf / 2 + 20), by - dy * (lf / 2 + 20) + 32);

    // Cotas: longitud, desnivel y velocidad.
    ctx.fillStyle = c.suave; ctx.textAlign = "left";
    ctx.fillText(`L = ${fmt(dib.L, 1)} m · H = ${fmt(dib.H, 2)} m · δ = ${fmt(dib.deltaDeg, 2)}°`, 8, alto - 10);
    ctx.textAlign = "right";
    ctx.fillText(`v = ${fmt(dib.v, 2)} m/s →`, ancho - 8, 18);
    if (Math.abs(dib.deltaDeg) > 22) {
      ctx.textAlign = "left";
      ctx.fillText("(inclinación dibujada a 22°)", 8, 18);
    }
  }

  // Sección transversal de la artesa con el material (paso 1).
  function dibujarSeccion(geo, d) {
    const canvas = $("seccion");
    const { ctx, ancho, alto } = prepararCanvas(canvas);
    const c = colores();
    if (!geo) {
      ctx.fillStyle = c.suave; ctx.font = "13px Barlow, system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("La sección se dibuja con el método geométrico", ancho / 2, alto / 2);
      return;
    }
    const { b, l3, lambda, talud } = geo;
    const lado = (b - l3) / 2;
    const anchoReal = l3 + 2 * lado * Math.cos(lambda);
    const hTrap = lado * Math.sin(lambda);
    const hPar = anchoReal * Math.tan(talud) / 4;    // flecha de la parábola: área 2/3·w·h = S1
    const escala = Math.min((ancho - 40) / (Bm(d) * 1.05), (alto - 30) / Math.max(hTrap + hPar, 0.05) * 0.9);
    const cx = ancho / 2, base = alto - 18;
    const X = x => cx + x * escala, Y = y => base - y * escala;

    // Puntos de la artesa (con la anchura útil b; el resto de la banda en gris).
    const p = [
      [-anchoReal / 2, hTrap], [-l3 / 2, 0], [l3 / 2, 0], [anchoReal / 2, hTrap]
    ];
    // Material: trapecio + parábola.
    ctx.fillStyle = c.material;
    ctx.beginPath();
    ctx.moveTo(X(p[0][0]), Y(p[0][1]));
    ctx.lineTo(X(p[1][0]), Y(p[1][1]));
    ctx.lineTo(X(p[2][0]), Y(p[2][1]));
    ctx.lineTo(X(p[3][0]), Y(p[3][1]));
    ctx.quadraticCurveTo(X(0), Y(hTrap + 2 * hPar), X(p[0][0]), Y(p[0][1]));
    ctx.fill();

    // Banda completa (B) siguiendo la artesa.
    const extra = (Bm(d) - b) / 2;
    ctx.strokeStyle = c.banda; ctx.lineWidth = 4; ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(X(p[0][0] - extra * Math.cos(lambda)), Y(p[0][1] + extra * Math.sin(lambda)));
    p.forEach(([x, y]) => ctx.lineTo(X(x), Y(y)));
    ctx.lineTo(X(p[3][0] + extra * Math.cos(lambda)), Y(p[3][1] + extra * Math.sin(lambda)));
    ctx.stroke();

    // Rodillos (rectángulos bajo la banda).
    ctx.fillStyle = c.acero;
    const rodillo = (xa, ya, xb, yb) => {
      const a = Math.atan2(yb - ya, xb - xa), len = Math.hypot(xb - xa, yb - ya);
      ctx.save(); ctx.translate(xa, ya); ctx.rotate(a);
      ctx.fillRect(4, 5, len - 8, 9); ctx.restore();
    };
    if (l3 > 0) rodillo(X(p[1][0]), Y(p[1][1]), X(p[2][0]), Y(p[2][1]));
    if (lambda > 0) {
      rodillo(X(p[0][0] - extra * Math.cos(lambda)), Y(p[0][1] + extra * Math.sin(lambda)), X(p[1][0]), Y(p[1][1]));
      rodillo(X(p[2][0]), Y(p[2][1]), X(p[3][0] + extra * Math.cos(lambda)), Y(p[3][1] + extra * Math.sin(lambda)));
    } else {
      rodillo(X(-Bm(d) / 2), Y(0), X(Bm(d) / 2), Y(0));
    }

    ctx.fillStyle = c.suave; ctx.font = "12px Barlow, system-ui, sans-serif"; ctx.textAlign = "left";
    ctx.fillText(`B = ${d.B} mm · b = ${fmt(b * 1000, 0)} mm · λ = ${fmt(aGrados(lambda), 0)}° · β = ${fmt(d.talud, 0)}°`, 8, 14);
  }
  const Bm = d => d.B / 1000;

  // Vano entre dos artesas con la flecha exagerada (paso 7).
  function dibujarVano(vano) {
    const canvas = $("vano");
    const { ctx, ancho, alto } = prepararCanvas(canvas);
    const c = colores();
    ctx.font = "12px Barlow, system-ui, sans-serif";
    if (!vano) {
      ctx.fillStyle = c.suave; ctx.textAlign = "center";
      ctx.fillText("Sin T2 no se puede dibujar el vano", ancho / 2, alto / 2);
      return;
    }
    const xa = 70, xb = ancho - 70, y = 80, r = 14, sag = 55;   // flecha dibujada exagerada
    ctx.fillStyle = c.material;
    ctx.beginPath(); ctx.moveTo(xa, y - r);
    ctx.quadraticCurveTo((xa + xb) / 2, y - r + 2 * sag - 70, xb, y - r);
    ctx.quadraticCurveTo((xa + xb) / 2, y - r + 2 * sag, xa, y - r);
    ctx.fill();
    ctx.strokeStyle = c.banda; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(10, y - r); ctx.lineTo(xa, y - r);
    ctx.quadraticCurveTo((xa + xb) / 2, y - r + 2 * sag, xb, y - r); ctx.lineTo(ancho - 10, y - r); ctx.stroke();
    [xa, xb].forEach(x => {
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fillStyle = c.acero; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI); ctx.fillStyle = c.fondo; ctx.fill();
    });
    const xm = (xa + xb) / 2;
    ctx.strokeStyle = c.mal; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(xa, y - r); ctx.lineTo(xb, y - r); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(xm, y - r); ctx.lineTo(xm, y - r + sag); ctx.stroke();
    ctx.fillStyle = c.mal; ctx.textAlign = "left";
    ctx.fillText(`h = ${fmt(vano.h * 1000, 1)} mm`, xm + 8, y - r + sag / 2 + 4);
    const yc = alto - 40;
    ctx.strokeStyle = c.tinta; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xa, y + r + 4); ctx.lineTo(xa, yc + 6); ctx.moveTo(xb, y + r + 4); ctx.lineTo(xb, yc + 6);
    ctx.moveTo(xa, yc); ctx.lineTo(xb, yc); ctx.stroke();
    ctx.fillStyle = c.tinta; ctx.textAlign = "center";
    ctx.font = "600 13px Barlow, system-ui, sans-serif";
    ctx.fillText(`l = ${fmt(vano.l, 2)} m (artesas)`, xm, yc - 6);
    ctx.font = "12px Barlow, system-ui, sans-serif";
    ctx.fillStyle = c.suave; ctx.textAlign = "left";
    ctx.fillText(`T = ${fmt(vano.T, 0)} N (T2, cola)`, 10, y - r - 10);
    ctx.fillText("Flecha dibujada exagerada", 10, alto - 10);
  }

  // Triángulo de inclinación (paso 1): cambia con δ y descompone el peso del material.
  function dibujarInclinacion(dib) {
    const canvas = $("incl");
    const { ctx, ancho, alto } = prepararCanvas(canvas);
    const c = colores();
    ctx.font = "12px Barlow, system-ui, sans-serif";
    const real = dib.deltaDeg;
    const lim = 40;
    const ang = Math.max(-lim, Math.min(lim, real)) * Math.PI / 180;
    const largo = Math.min((ancho - 70) / Math.cos(ang), (alto - 110) / Math.max(Math.abs(Math.sin(ang)), 1e-6));
    const ax = Math.cos(ang) * largo, ay = Math.sin(ang) * largo;
    const x0 = 30, y0 = (alto - 30) / 2 + ay / 2 - 6;
    const x1 = x0 + ax, y1 = y0 - ay;
    const u = { x: Math.cos(ang), y: -Math.sin(ang) };       // sentido de avance de la banda
    const nrm = { x: Math.sin(ang), y: Math.cos(ang) };       // normal hacia abajo

    // Horizontal y vertical (cateto H) en discontinua.
    ctx.strokeStyle = c.suave; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.setLineDash([]);

    // Banda y tambores.
    ctx.strokeStyle = c.banda; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    [[x0, y0], [x1, y1]].forEach(([x, y]) => {
      ctx.beginPath(); ctx.arc(x + nrm.x * 9, y + nrm.y * 9, 9, 0, 2 * Math.PI);
      ctx.fillStyle = c.fondo; ctx.fill(); ctx.lineWidth = 3; ctx.stroke();
    });

    // Arco y valor del ángulo δ.
    const ra = Math.min(90, largo * 0.3);
    if (Math.abs(ang) > 0.002) {
      ctx.strokeStyle = c.mal; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x0, y0, ra, Math.min(0, -ang), Math.max(0, -ang)); ctx.stroke();
    }
    ctx.fillStyle = c.mal; ctx.textAlign = "left";
    ctx.font = "600 13px Barlow, system-ui, sans-serif";
    const yEtq = Math.abs(ang) < 0.05 ? y0 + 26 : y0 - (ra + 8) * Math.sin(ang / 2) + (ang > 0 ? 4 : 24);
    ctx.fillText(`δ = ${fmt(real, 2)}°`, x0 + (ra + 8) * Math.cos(ang / 2), yEtq);
    ctx.font = "12px Barlow, system-ui, sans-serif";

    // Cotas L y H (H a la izquierda del cateto para que no se corte).
    ctx.fillStyle = c.suave;
    const tL = ang < -0.01 ? 0.42 : 0.22;
    ctx.save(); ctx.translate(x0 + ax * tL - nrm.x * 14, y0 - ay * tL - nrm.y * 14); ctx.rotate(-ang);
    ctx.textAlign = "center"; ctx.fillText(`L = ${fmt(dib.L, 1)} m`, 0, 0); ctx.restore();
    if (Math.abs(ay) > 16) {
      ctx.textAlign = "right";
      ctx.fillText(`H = ${fmt(dib.H, 2)} m`, x1 - 8, (y0 + y1) / 2 + (ang > 0 ? 16 : -6));
    }

    // Montón de material y descomposición de su peso.
    const t = 0.58;
    const mx = x0 + ax * t, my = y0 - ay * t;
    ctx.save(); ctx.translate(mx, my); ctx.rotate(-ang);
    ctx.fillStyle = c.material;
    ctx.beginPath(); ctx.moveTo(-36, -2); ctx.quadraticCurveTo(0, -44, 36, -2); ctx.closePath(); ctx.fill();
    ctx.restore();
    const gx = mx - nrm.x * 12, gy = my - nrm.y * 12;     // centro de gravedad aproximado
    const W = 70;
    const comp = -W * Math.sin(ang);                       // proyección del peso sobre la banda
    const ta = { x: u.x * comp, y: u.y * comp };
    const na = { x: -ta.x, y: W - ta.y };
    const qg = dib.qg || 0;
    const sen = Math.sin(real * Math.PI / 180), cos = Math.cos(real * Math.PI / 180);

    flecha(ctx, gx, gy, gx + na.x, gy + na.y, c.acero, 2);
    flecha(ctx, gx, gy, gx, gy + W, c.tinta, 2);
    ctx.fillStyle = c.tinta; ctx.textAlign = "right";
    ctx.fillText("q·g", gx - 6, gy + W);
    ctx.fillStyle = c.acero; ctx.textAlign = "left";
    ctx.fillText("q·g·cos δ", gx + Math.max(na.x, 0) + 6, gy + na.y);
    if (Math.abs(comp) > 2) {
      flecha(ctx, gx, gy, gx + ta.x * 1.6, gy + ta.y * 1.6, c.mal, 3);
      ctx.fillStyle = c.mal; ctx.textAlign = ta.x < 0 ? "right" : "left";
      ctx.fillText("q·g·sen δ", gx + ta.x * 1.6 + (ta.x < 0 ? -6 : 6), gy + ta.y * 1.6 - 8);
    }

    // Leyenda con los valores por metro de cinta.
    const leyenda = [
      [c.mal, `a lo largo: q·g·sen δ = ${fmt(qg * 9.81 * sen, 1)} N/m`],
      [c.acero, `normal: q·g·cos δ = ${fmt(qg * 9.81 * cos, 1)} N/m`]
    ];
    ctx.textAlign = "left";
    if (ancho < 520) {
      leyenda.forEach(([col, txt], i) => { ctx.fillStyle = col; ctx.fillText(txt, 8, alto - 24 + i * 15); });
    } else {
      ctx.fillStyle = leyenda[0][0]; ctx.fillText(leyenda[0][1], 8, alto - 10);
      const w0 = ctx.measureText(leyenda[0][1]).width;
      ctx.fillStyle = leyenda[1][0]; ctx.fillText(leyenda[1][1], 8 + w0 + 18, alto - 10);
    }

    // Texto informativo.
    ctx.fillStyle = c.suave; ctx.textAlign = "left";
    const sentido = real > 0.01 ? "sube: la gravedad frena" : real < -0.01 ? "baja: la gravedad empuja" : "horizontal: sin componente a lo largo";
    ctx.fillText(`Cinta ${sentido} · K = ${fmt(dib.K, 3)}`, 8, 16);
    if (Math.abs(real) > lim) ctx.fillText(`(dibujo limitado a ${lim}°)`, 8, 32);
  }

  // Detalle del tambor motriz (paso 5): el arco de contacto cambia con θ.
  function dibujarTambor(dib) {
    const canvas = $("tambor");
    const { ctx, ancho, alto } = prepararCanvas(canvas);
    const c = colores();
    ctx.font = "12px Barlow, system-ui, sans-serif";
    const lim = 250;   // con un solo tambor de reenvío no se dibujan abrazamientos mayores
    const thDeg = Math.max(20, Math.min(lim, dib.theta || 0));
    const th = thDeg * Math.PI / 180;
    const R = Math.min(alto * 0.26, ancho * 0.15);
    const cx = ancho - R - 78, cy = alto * 0.46;
    const desliza = dib.ratio !== null && dib.ratio > dib.k + 1e-9;
    const colorArco = dib.ratio === null ? c.acero : (desliza ? c.mal : c.ok);

    // θ ≤ 180°: el arco de contacto se centra en el lado derecho del tambor (de -θ/2 a +θ/2).
    // θ > 180°: el ramal tenso llega horizontal por arriba (-90°) y todo el abrazamiento
    // adicional lo da un único tambor de reenvío en el ramal flojo, abajo.
    const conReenvio = th > Math.PI + 1e-9;
    const a1 = conReenvio ? -Math.PI / 2 : -th / 2;
    const a2 = conReenvio ? -Math.PI / 2 + th : th / 2;
    const P1 = { x: cx + R * Math.cos(a1), y: cy + R * Math.sin(a1) };
    const P2 = { x: cx + R * Math.cos(a2), y: cy + R * Math.sin(a2) };
    const d1 = { x: -Math.sin(a1), y: Math.cos(a1) };      // movimiento del ramal que entra (T1)
    const d2 = { x: -Math.sin(a2), y: Math.cos(a2) };      // movimiento del ramal que sale (T2)

    ctx.strokeStyle = c.banda; ctx.lineWidth = 4; ctx.lineJoin = "round";
    let fin1, fin2;
    if (!conReenvio) {
      // Sin tambor de reenvío: los ramales salen rectos hacia la izquierda.
      // Si θ < 180°, los ramales salen inclinados y un rodillo los devuelve a la horizontal.
      let l1 = (P1.x - 10) / Math.max(d1.x, 0.2), l2 = (P2.x - 10) / Math.max(-d2.x, 0.2);
      if (d1.y > 0.01) l1 = Math.min(l1, (P1.y - 26) / d1.y);
      if (d2.y > 0.01) l2 = Math.min(l2, (alto - 60 - P2.y) / d2.y);
      const E1 = { x: P1.x - d1.x * l1, y: P1.y - d1.y * l1 };
      const E2 = { x: P2.x + d2.x * l2, y: P2.y + d2.y * l2 };
      fin1 = { x: 10, y: E1.y };
      fin2 = { x: 10, y: E2.y };
      ctx.beginPath(); ctx.moveTo(fin1.x, fin1.y); ctx.lineTo(E1.x, E1.y); ctx.lineTo(P1.x, P1.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(P2.x, P2.y); ctx.lineTo(E2.x, E2.y); ctx.lineTo(fin2.x, fin2.y); ctx.stroke();
      if (E1.x > 14) [E1, E2].forEach(E => {
        ctx.beginPath(); ctx.arc(E.x, E.y, 5, 0, 2 * Math.PI); ctx.fillStyle = c.acero; ctx.fill();
      });
    } else {
      // θ > 180°: el ramal tenso entra recto y horizontal por la parte de arriba del tambor;
      // el ramal flojo sale tangente y un solo tambor de reenvío lo devuelve a la horizontal.
      const rs = 0.32 * R;
      fin1 = { x: 10, y: P1.y };
      ctx.beginPath(); ctx.moveTo(fin1.x, fin1.y); ctx.lineTo(P1.x, P1.y); ctx.stroke();
      // Tramo inclinado hasta el reenvío: sin acercarse demasiado al ramal tenso.
      const hueco = P2.y - P1.y - 2 * rs - 12;
      const l = Math.max(0.3 * R, Math.min(1.4 * R, hueco / Math.max(-d2.y, 0.05)));
      const E2 = { x: P2.x + d2.x * l, y: P2.y + d2.y * l };
      const n2 = { x: d2.y, y: -d2.x };
      if (n2.y < 0) { n2.x *= -1; n2.y *= -1; }        // reenvío por debajo del ramal flojo
      const S2 = { x: E2.x + n2.x * rs, y: E2.y + n2.y * rs };
      fin2 = { x: 10, y: S2.y - rs };
      ctx.beginPath(); ctx.moveTo(P2.x, P2.y); ctx.lineTo(E2.x, E2.y); ctx.lineTo(S2.x, S2.y - rs); ctx.lineTo(fin2.x, fin2.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(S2.x, S2.y, rs, 0, 2 * Math.PI);
      ctx.fillStyle = c.fondo; ctx.fill(); ctx.strokeStyle = c.acero; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = c.suave; ctx.textAlign = "center";
      ctx.fillText("reenvío", S2.x, S2.y + rs + 14);
      ctx.strokeStyle = c.banda; ctx.lineWidth = 4;
    }

    // Tambor y arco de contacto.
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI);
    ctx.fillStyle = c.acero; ctx.fill();
    ctx.strokeStyle = colorArco; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(cx, cy, R + 1, a1, a2); ctx.stroke();
    ctx.strokeStyle = c.banda; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(P1.x, P1.y); ctx.moveTo(cx, cy); ctx.lineTo(P2.x, P2.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 2 * Math.PI); ctx.fillStyle = c.fondo; ctx.fill();

    // Sentido de giro (horario) dentro del tambor.
    ctx.strokeStyle = c.fondo; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.55, -2.4, -0.6); ctx.stroke();
    const fa = -0.6, fx = cx + R * 0.55 * Math.cos(fa), fy = cy + R * 0.55 * Math.sin(fa);
    flecha(ctx, fx - 6 * Math.cos(fa + Math.PI / 2), fy - 6 * Math.sin(fa + Math.PI / 2), fx, fy, c.fondo, 2);

    // Etiquetas.
    ctx.fillStyle = colorArco; ctx.textAlign = "left";
    ctx.font = "600 13px Barlow, system-ui, sans-serif";
    ctx.fillText(`θ = ${fmt(dib.theta, 0)}°`, cx + R + 10, cy + 4);
    ctx.font = "12px Barlow, system-ui, sans-serif";
    ctx.fillStyle = c.tinta; ctx.textAlign = "left";
    const corto = ancho < 520;
    ctx.fillText(`T1 = ${dib.T1 ? fmt(dib.T1, 0) + " N" : "—"}${corto ? "" : " (tenso)"}`, 12, fin1.y - 8);
    ctx.fillStyle = c.suave;
    ctx.fillText(`T2 = ${dib.T2 ? fmt(dib.T2, 0) + " N" : "—"}${corto ? "" : " (flojo)"}`, 12, fin2.y + 18);

    ctx.fillStyle = colorArco; ctx.textAlign = "left";
    let estado = `e^(μθ) = ${fmt(dib.k, 3)}`;
    if (dib.ratio !== null) estado += ` · T1/T2 = ${fmt(dib.ratio, 3)} → ${desliza ? "desliza" : "no desliza"}`;
    ctx.fillText(estado, 12, alto - 10);
    if ((dib.theta || 0) > lim) { ctx.fillStyle = c.suave; ctx.fillText(`(dibujo limitado a ${lim}°)`, 12, 16); }
  }

  // ---- Ciclo principal ------------------------------------------------------
  let ultimo = null;
  function actualizar() {
    actualizarVisibilidad();
    const d = leerDatos();
    const resultado = calcular(d, tablas);
    ultimo = { d, resultado };
    ["geometria", "capacidad", "resistencias", "potencia", "tensiones", "capas", "separacion"].forEach(s => pintarSeccion(s, resultado));
    // Si el caudal fija la velocidad o el ancho, esos campos se rellenan solos y no se editan.
    const ajuste = d.modoQg === "caudal" ? d.ajusteCaudal : "ninguno";
    const vAj = resultado.valores.v, BAj = resultado.valores.B;
    $("v").readOnly = ajuste === "velocidad";
    $("B").disabled = ajuste === "ancho";
    if (ajuste === "velocidad" && Number.isFinite(vAj) && Number($("v").value) !== vAj) $("v").value = Math.round(vAj * 1000) / 1000;
    if (ajuste === "ancho" && String(BAj) !== $("B").value) $("B").value = BAj;
    pintarResumen(resultado.valores);
    dibujarEsquema(resultado.valores._dibujo);
    dibujarSeccion(d.metodoSeccion === "geometrico" ? resultado.valores._geo : null, { ...d, B: BAj, v: vAj });
    dibujarInclinacion(resultado.valores._dibujo);
    dibujarTambor(resultado.valores._dibujo);
    dibujarVano(resultado.valores._vano);
    // Panel del caudal: qué se ha ajustado y cuánto se llena la cinta.
    const est = $("caudal-estado");
    if (d.modoQg === "caudal") {
      const llen = resultado.valores.Qm > 0 ? d.Qdato / resultado.valores.Qm * 100 : null;
      est.textContent = `Con ${fmt(d.Qdato, 1)} t/h: B = ${BAj} mm · v = ${fmt(vAj, 2)} m/s · llenado ${fmt(llen, 0)} % · q_g = ${fmt(resultado.valores.qgCaudal, 1)} kg/m`;
    } else {
      est.textContent = `Ahora la carga del material sale del paso 3 («${$("modoQg").selectedOptions[0].text}»). Escribe o mueve el caudal para usarlo.`;
    }
    // Los deslizadores siguen a los valores escritos.
    const sinc = (id, v) => { if (document.activeElement !== $(id) && Number.isFinite(v)) $(id).value = v; };
    sinc("desl-incl", resultado.valores.deltaDeg);
    sinc("desl-lambda", d.lambda);
    sinc("desl-theta", d.theta);
    // Deslizador del caudal: llega hasta 1,5 veces la capacidad máxima (o más si el dato es mayor).
    if (document.activeElement !== $("desl-caudal")) {
      // Con ajuste de v o B el tope es el caudal máximo alcanzable (v máxima o ancho máximo).
      const base = resultado.valores.QmaxAjuste ? resultado.valores.QmaxAjuste * 1.1 : (resultado.valores.Qm || 0) * 1.5;
      const tope = Math.max(100, base, (d.Qdato || 0) * 1.2);
      $("desl-caudal").max = Math.ceil(tope / 10) * 10;
      sinc("desl-caudal", d.Qdato);
    }
  }

  function cargarSeleccion() {
    const id = $("selector-ejemplo").value;
    if (id === "propios") {
      ejemploActual = null;
      escribirDatos(ejemplos.propios);
      $("enunciado").textContent = "Introduce tus datos o elige un ejemplo de los apuntes: todo se recalcula al momento.";
    } else {
      ejemploActual = ejemplos.ejemplos.find(e => e.id === id);
      escribirDatos({ ...ejemplos.baseEjemplos, ...ejemploActual.datos });
      $("enunciado").textContent = ejemploActual.enunciado;
    }
    actualizar();
    if (ejemploActual) {
      const destino = $("paso-" + ejemploActual.seccion);
      if (destino && window.matchMedia("(min-width: 900px)").matches === false) destino.scrollIntoView({ behavior: "smooth" });
    }
  }

  function rellenarListas() {
    // Anchos de banda.
    const selB = $("B");
    tablas.anchosBanda.forEach(b => selB.add(new Option(`${b} mm`, b)));
    // Ayuda para f.
    const selF = $("ayuda-f");
    tablas.coeficienteRozamientoRodillos.opciones.forEach(o => selF.add(new Option(`${o.texto}: ${fmt(o.f, 3)}`, o.f)));
    selF.addEventListener("change", () => { if (selF.value) { $("f").value = selF.value; selF.value = ""; actualizar(); } });
    // Materiales agrupados.
    const selM = $("material");
    const grupos = {};
    tablas.materiales.materiales.forEach(m => {
      if (!grupos[m.grupo]) { grupos[m.grupo] = document.createElement("optgroup"); grupos[m.grupo].label = m.grupo; selM.appendChild(grupos[m.grupo]); }
      grupos[m.grupo].appendChild(new Option(m.nombre + (m.estado ? ` (${m.estado})` : ""), m.id));
    });
    // Al elegir un material se rellenan ρ, β y la clase (se pueden cambiar después).
    selM.addEventListener("input", () => {
      const m = tablas.materiales.materiales.find(x => x.id === selM.value);
      if (!m) return;
      const pm = propiedadesMaterial(m, tablas.materiales);
      if (pm.rho !== null) $("rho").value = pm.rho;
      if (pm.beta !== null) $("talud").value = pm.beta;
      if (pm.clase) $("claseMaterial").value = pm.clase;
    });
    // Selector de ejemplos.
    const sel = $("selector-ejemplo");
    sel.add(new Option("Datos propios", "propios"));
    const grupo = document.createElement("optgroup");
    grupo.label = "Ejemplos de los apuntes";
    ejemplos.ejemplos.forEach(e => grupo.appendChild(new Option(e.titulo, e.id)));
    sel.appendChild(grupo);
  }

  async function iniciar() {
    try {
      const [rt, re, rm] = await Promise.all([fetch("tablas.json?v=" + VERSION), fetch("ejemplos.json?v=" + VERSION), fetch("materiales.json?v=" + VERSION)]);
      if (!rt.ok || !re.ok || !rm.ok) throw new Error("No se pudieron leer los archivos JSON");
      tablas = await rt.json();
      ejemplos = await re.json();
      tablas.materiales = await rm.json();
    } catch (error) {
      $("estado").textContent = "No se pudieron cargar tablas.json, materiales.json y ejemplos.json. Abre la página con un servidor local (python -m http.server 8000) o desde GitHub Pages; abrir index.html con doble clic no permite leer archivos JSON.";
      console.error(error);
      return;
    }
    rellenarListas();
    $("selector-ejemplo").addEventListener("change", cargarSeleccion);
    $("recargar").addEventListener("click", cargarSeleccion);
    // Deslizadores: escriben en el campo numérico correspondiente.
    $("desl-incl").addEventListener("input", e => {
      const grados = Number(e.target.value);
      if ($("modoIncl").value === "angulo") $("anguloDeg").value = grados;
      else $("H").value = (Number($("L").value) * Math.sin(grados * Math.PI / 180)).toFixed(2);
    });
    $("desl-lambda").addEventListener("input", e => { $("lambda").value = e.target.value; });
    $("desl-theta").addEventListener("input", e => { $("theta").value = e.target.value; });
    // Tocar el caudal (casilla, deslizador o qué se ajusta) pasa a calcular la carga desde el caudal.
    const usarCaudal = () => { $("modoQg").value = "caudal"; };
    $("desl-caudal").addEventListener("input", e => { $("Qdato").value = e.target.value; usarCaudal(); });
    $("Qdato").addEventListener("input", usarCaudal);
    $("ajusteCaudal").addEventListener("input", usarCaudal);
    // Al pasar a «Desde el caudal» se parte del caudal que ya transportaba la cinta.
    // Se escucha «input» (llega antes que el recálculo del formulario) para leer el estado anterior.
    $("modoQg").addEventListener("input", () => {
      if ($("modoQg").value !== "caudal" || !ultimo) return;
      const Q = ultimo.resultado.valores.Qreal;
      if (Number.isFinite(Q) && Q > 0) $("Qdato").value = Math.round(Q * 10) / 10;
    });
    document.querySelector("form").addEventListener("input", actualizar);
    document.querySelector("form").addEventListener("change", actualizar);
    document.querySelector("form").addEventListener("submit", e => e.preventDefault());
    window.addEventListener("resize", () => ultimo && actualizar());
    // Permite abrir directamente un ejemplo con index.html#ej8b
    const inicial = location.hash.slice(1);
    $("selector-ejemplo").value = ejemplos.ejemplos.some(e => e.id === inicial) ? inicial : "propios";
    cargarSeleccion();
  }

  iniciar();
}
