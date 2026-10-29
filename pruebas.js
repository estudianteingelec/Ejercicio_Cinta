// pruebas.js: comprueba el cálculo con los ejemplos de los apuntes y con las
// funciones nuevas (caudal, separación automática). Uso: node pruebas.js
"use strict";
const { calcular, seccionMaterial } = require("./script.js");
const tablas = require("./tablas.json");
tablas.materiales = require("./materiales.json");
const ejemplos = require("./ejemplos.json");

let ok = 0, fallos = 0;
function comprueba(nombre, valor, esperado, tolRel = 0.005) {
  const bien = Number.isFinite(valor) && Math.abs(valor - esperado) <= Math.max(Math.abs(esperado) * tolRel, 1e-9);
  if (bien) ok++; else { fallos++; console.log(`  ✗ ${nombre}: ${valor} (esperado ${esperado})`); }
}
function cierto(nombre, cond) { if (cond) ok++; else { fallos++; console.log(`  ✗ ${nombre}`); } }
const ej = (id, extra = {}) => {
  const e = ejemplos.ejemplos.find(x => x.id === id);
  return calcular({ ...ejemplos.baseEjemplos, ...e.datos, ...extra }, tablas).valores;
};

// ---- 1. Ejemplos de los apuntes ------------------------------------------
let v = ej("ej1");  comprueba("ej1 FH", v.FH, 600.37); comprueba("ej1 FN", v.FN, 120); comprueba("ej1 Fu", v.Fu, 760.37);
v = ej("ej2");      comprueba("ej2 LC", v.LC, 290); comprueba("ej2 FH+FN", v.FHFN, 2901.80); comprueba("ej2 Fu", v.Fu, 2941.80); comprueba("ej2 Pu", v.Pu, 5.88);
v = ej("ej3");      comprueba("ej3 Pu", v.Pu, 1.52); comprueba("ej3 P", v.Pmotor, 1.69); comprueba("ej3 M", v.M, 152.07); comprueba("ej3 ω", v.omega, 10); comprueba("ej3 n", v.n, 95.5);
v = ej("ej4");      comprueba("ej4 k", v.k, 2.5663); comprueba("ej4 T1", v.T1, 1160.37); comprueba("ej4 T2adh", v.T2adh, 485.45);
v = ej("ej4", { T2: 600 }); comprueba("ej4 T1 (T2=600)", v.T1, 1360.37); comprueba("ej4 reserva", v.reserva, 23.6, 0.01);
v = ej("ej5");      comprueba("ej5 h sup", v.hsup, 11.65); comprueba("ej5 h inf", v.hinf, 22.60); comprueba("ej5 Tsup mín", v.TsupMin, 4855.95); comprueba("ej5 Tinf mín", v.TinfMin, 2354.40);
v = ej("ej6");      comprueba("ej6 z calc", v.zCalc, 1.547); comprueba("ej6 z", v.z, 2);
v = ej("ej7");      comprueba("ej7 δ", v.deltaDeg, 4.59); comprueba("ej7 FH", v.FH, 758.31); comprueba("ej7 FSt", v.FSt, 1177.2); comprueba("ej7 Fu", v.Fu, 2055.51);
v = ej("ej8");      comprueba("ej8 LC", v.LC, 337.5); comprueba("ej8 FH+FN", v.FHFN, 4961.73); comprueba("ej8 Fu", v.Fu, 8553.33); comprueba("ej8 Pu", v.Pu, 21.38);
v = ej("ej8b");
comprueba("ej8b δ", v.deltaDeg, 2.866); comprueba("ej8b LC", v.LC, 290); comprueba("ej8b FH+FN", v.FHFN, 2898.88);
comprueba("ej8b FSt", v.FSt, 2452.50); comprueba("ej8b Fu", v.Fu, 5391.38); comprueba("ej8b Pu", v.Pu, 10.78);
comprueba("ej8b P", v.Pmotor, 11.98); comprueba("ej8b M", v.M, 1078.28); comprueba("ej8b n", v.n, 95.5);
comprueba("ej8b k", v.k, 2.5663); comprueba("ej8b T2adh", v.T2adh, 3442); comprueba("ej8b T1", v.T1, 9391.38);
comprueba("ej8b T1/T2", v.ratio, 2.3478); comprueba("ej8b Fu máx", v.FuMaxAdh, 6265); comprueba("ej8b reserva", v.reserva, 16.2, 0.01);
comprueba("ej8b h sup", v.hsup, 9.70); comprueba("ej8b h inf", v.hinf, 14.11); comprueba("ej8b Tsup mín", v.TsupMin, 4849.88);
comprueba("ej8b Tinf mín", v.TinfMin, 2351.46); comprueba("ej8b z calc", v.zCalc, 0.807); comprueba("ej8b z", v.z, 3); comprueba("ej8b Tadm", v.Tadm, 34909);
v = ej("ej9");      comprueba("ej9 Fu máx", v.FuMaxAdh, 4698); comprueba("ej9 θ mín", v.thetaMin, 248.1);
v = ej("ej9", { theta: 270 }); comprueba("ej9 Fu máx (270°)", v.FuMaxAdh, 9336); comprueba("ej9 reserva (270°)", v.reserva, 16.7, 0.01);
v = ej("ej10");     comprueba("ej10 T2adh", v.T2adh, 8511); comprueba("ej10 θ mín", v.thetaMin, 304.5); comprueba("ej10 Tadm", v.Tadm, 34909);
v = ej("ej10", { theta: 315 }); comprueba("ej10 Fu máx (315°)", v.FuMaxAdh, 12817); comprueba("ej10 reserva (315°)", v.reserva, 6.8, 0.02);
v = ej("ej11");     comprueba("ej11 Pu", v.Pu, 2); comprueba("ej11 P", v.Pmotor, 2.22); comprueba("ej11 ω", v.omega, 20); comprueba("ej11 n", v.n, 191);
v = ej("ej12");     comprueba("ej12 z calc", v.zCalc, 11.28); comprueba("ej12 z", v.z, 12); comprueba("ej12 S", v.Sseg, 13);
v = ej("ej13");     comprueba("ej13 K", v.K, 0.81); comprueba("ej13 Q", v.Qm, 102.9);
v = ej("ej14");     comprueba("ej14 Fu", v.Fu, 50000); comprueba("ej14 T2", v.T2adh, 66840);
v = ej("ej15");     comprueba("ej15 separación máx.", v.lRsupMax, 1.087);

// ---- 2. Datos por defecto = ejemplo resuelto del README -------------------
v = calcular({ ...ejemplos.propios }, tablas).valores;
comprueba("defecto B", v.B, 600); comprueba("defecto Qmáx", v.Qm, 368.8); comprueba("defecto qg", v.qgCaudal, 33.23);
comprueba("defecto C", v.C, 1.62); comprueba("defecto FH+FN", v.FHFN, 2599.73); comprueba("defecto FSt", v.FSt, 1955.74);
comprueba("defecto Fu", v.Fu, 4615.47); comprueba("defecto P", v.Pmotor, 10.72); comprueba("defecto M", v.M, 1153.87);
comprueba("defecto n", v.n, 79.8); comprueba("defecto T2", v.T2, 6352.90); comprueba("defecto T1", v.T1, 10968.37);
comprueba("defecto artesas", v.lRsupAd, 1.0); comprueba("defecto retorno", v.lRinfAd, 2.4); comprueba("defecto z", v.z, 3);
comprueba("defecto Tadm", v.Tadm, 26182); comprueba("defecto caudal transportado", v.Qreal, 250);

// ---- 3. Caudal: ajuste del ancho y de la velocidad ------------------------
const base = { ...ejemplos.propios };
const anchos = { 150: 500, 250: 600, 600: 800, 1200: 1200 };
for (const [Q, B] of Object.entries(anchos)) {
  v = calcular({ ...base, Qdato: Number(Q), ajusteCaudal: "ancho" }, tablas).valores;
  comprueba(`ancho para ${Q} t/h`, v.B, B);
  cierto(`capacidad ≥ caudal (${Q} t/h)`, v.Qm >= Number(Q) - 1e-6);
  comprueba(`caudal transportado ${Q} t/h`, v.Qreal, Number(Q));
}
// el ancho elegido es el menor posible: el anterior no llega
for (const Q of [150, 250, 600, 1200]) {
  v = calcular({ ...base, Qdato: Q, ajusteCaudal: "ancho" }, tablas).valores;
  const i = tablas.anchosBanda.indexOf(v.B);
  const anterior = tablas.anchosBanda.slice(0, i).reverse().find(B => seccionMaterial(B, base, tablas) !== null);
  if (anterior) cierto(`${Q} t/h: ${anterior} mm no llega`, 3.6 * base.v * seccionMaterial(anterior, base, tablas) * base.rho * v.K < Q);
}
for (const Q of [100, 300, 700]) {
  v = calcular({ ...base, Qdato: Q, ajusteCaudal: "velocidad" }, tablas).valores;
  cierto(`velocidad DIN para ${Q} t/h`, tablas.velocidadesNormalizadas.valores.includes(v.v));
  cierto(`velocidad suficiente ${Q} t/h`, v.Qm >= Q - 1e-6 && v.vAdoptada >= v.vNec - 1e-9);
  comprueba(`velocidad necesaria ${Q} t/h`, v.vNec, Q / (3.6 * seccionMaterial(base.B, base, tablas) * base.rho * v.K));
}
v = calcular({ ...base, Qdato: 20000, ajusteCaudal: "ancho" }, tablas);
cierto("caudal imposible por ancho avisa", v.avisos.capacidad.some(a => a.tipo === "mal"));
v = calcular({ ...base, Qdato: 20000, ajusteCaudal: "velocidad" }, tablas);
cierto("caudal imposible por velocidad avisa", v.avisos.capacidad.some(a => a.tipo === "mal"));
v = calcular({ ...base, metodoSeccion: "directa", ajusteCaudal: "ancho" }, tablas);
cierto("sección conocida no ajusta el ancho (aviso)", v.avisos.capacidad.some(a => a.texto.includes("Sección conocida")));
v = calcular({ ...base, ajusteCaudal: "ninguno", B: 800, v: 2.09 }, tablas).valores;
cierto("sin ajuste se respeta B y v", v.B === 800 && v.v === 2.09);

// ---- 4. Separación automática entre artesas -------------------------------
for (const Q of [50, 150, 250, 600, 1200]) {
  for (const theta of [180, 200, 240]) {
    const r = calcular({ ...base, Qdato: Q, theta }, tablas);
    const x = r.valores;
    const n = `Q=${Q}, θ=${theta}`;
    cierto(`${n}: artesas entre 1 y 1,5 m`, x.lRsupAd >= 1 - 1e-9 && x.lRsupAd <= 1.5 + 1e-9);
    cierto(`${n}: artesas múltiplo de 5 cm`, Math.abs(x.lRsupAd * 20 - Math.round(x.lRsupAd * 20)) < 1e-6);
    cierto(`${n}: retorno 2–3 veces y ≤ 3 m`, x.lRinfAd >= 2 * x.lRsupAd - 1e-9 && x.lRinfAd <= Math.max(3, 2 * x.lRsupAd) + 1e-9);
    cierto(`${n}: flecha en cola cumple`, x.hrelCola <= 1 + 1e-9);
    cierto(`${n}: no desliza`, x.ratio <= x.k + 1e-9);
    cierto(`${n}: T1 ≤ Tadm`, x.T1 <= x.Tadm + 1e-6);
  }
}

// ---- 5. Casos límite: nunca debe romperse ni dar NaN en lo esencial -------
const raros = [
  { v: 0 }, { L: 0 }, { H: 500 }, { H: -30 }, { Qdato: 0 }, { Qdato: null }, { theta: 0 }, { mu: 0 },
  { hrelMax: 0 }, { B: 300 }, { nRodillos: 1 }, { nRodillos: 2, lambda: 45 }, { metodoSeccion: "tabla", B: 400, lambda: 30, talud: 20 },
  { metodoSeccion: "tabla", B: 800 }, { modoFu: "directa", FuDirecta: -10 }, { modoFu: "potencia", Pdato: 50 },
  { modoQg: "manual", qg: 500 }, { modoQg: "capacidad" }, { T2: 100 }, { modoSep: "dato", lRsup: 0 }, { rho: 0 }, { D: 0 }
];
for (const extra of raros) {
  const nombre = JSON.stringify(extra);
  try {
    const r = calcular({ ...base, ...extra }, tablas);
    cierto(`${nombre}: devuelve resultados`, r && r.secciones && r.avisos);
  } catch (e) { fallos++; console.log(`  ✗ ${nombre}: excepción ${e.message}`); }
}
// Todos los ejemplos con todos los modos de caudal
for (const e of ejemplos.ejemplos) for (const aj of ["ninguno", "ancho", "velocidad"]) {
  try { calcular({ ...ejemplos.baseEjemplos, ...e.datos, modoQg: "caudal", Qdato: 200, ajusteCaudal: aj }, tablas); ok++; }
  catch (err) { fallos++; console.log(`  ✗ ${e.id} ${aj}: ${err.message}`); }
}

console.log(`\n${ok} comprobaciones correctas, ${fallos} fallos.`);
process.exitCode = fallos ? 1 : 0;
