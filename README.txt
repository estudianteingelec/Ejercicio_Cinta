DIMENSIONADO DE UNA CINTA TRANSPORTADORA: HTML + CSS + JSON + JavaScript + Canvas
================================================================================

Objetivo
--------
Aplicación web que dimensiona una cinta transportadora de material a granel
siguiendo los apuntes de Transporte y Manutención Industrial (USAL), ISO 5048
y DIN 22101. A partir del caudal, el material, la longitud y el desnivel,
calcula: ancho de banda (o velocidad) necesario, fuerza periférica, potencia
del motor, tensiones T1 y T2, separación entre artesas y número de capas de
la banda. Dibuja en Canvas la cinta, la inclinación, la sección del material,
el tambor motriz y el vano entre artesas. Todo se recalcula al momento y
cada resultado muestra la fórmula con los números sustituidos.

Archivos
--------
- index.html: estructura de la página (formulario, resultados y <canvas>).
- styles.css: formato y aspecto.
- script.js: carga los JSON, calcula y dibuja.
- tablas.json: tablas de los apuntes (rodillos, factor K, velocidades DIN,
  Rulmeca, coeficiente f, factor C(L), coeficientes de seguridad).
- materiales.json: 10 materiales a granel (densidad, ángulo de reposo,
  inclinación máxima, fluidez).
- ejemplos.json: datos por defecto y los ejemplos 1 a 15 de los apuntes.
- pruebas.js: pruebas automáticas del cálculo (node pruebas.js). La página
  no lo necesita.

Cómo ejecutarlo (requiere Python instalado)
-------------------------------------------
1. Coloca todos los archivos en una misma carpeta.
2. Abre una terminal en esa carpeta.
3. Ejecuta:
   Windows:      py -m http.server 8000   (o python -m http.server 8000)
   macOS/Linux:  python3 -m http.server 8000
4. En el navegador abre: http://localhost:8000
5. Para detener el servidor, pulsa Ctrl+C.
(No se puede abrir index.html con doble clic: el navegador bloquea fetch() de
archivos locales. Por eso se usa un servidor.)
Si tras cambiar los archivos la página se ve igual, recarga con Ctrl+F5: el
pie de la página indica la versión. Con index.html#ej8b se abre un ejemplo.

Datos de entrada
----------------
- Caudal Q (t/h): panel de arriba, con casilla y deslizador. Se elige qué se
  ajusta para conseguirlo: el ancho B, la velocidad v o nada.
- Material: aporta la densidad rho, el ángulo de sobrecarga beta y la clase
  (A, B, C, D) para comprobar la velocidad máxima y el tamaño de fragmento.
- Rodillos por estación (1, 2 o 3) y ángulo de terna lambda.
- Longitud entre tambores L (m), desnivel H (m) y velocidad v (m/s).
- Masas de banda qb y de rodillos qR (kg/m), coeficiente f, resistencias
  especiales, rendimiento eta, diámetro del tambor D, rozamiento mu,
  abrazamiento theta, flecha admisible (%) y resistencia por capa R (N/mm).
- La separación entre artesas no se introduce: se calcula sola (paso 7).

Método de cálculo
-----------------
1) Inclinación:          delta = arcsen(H / L)
2) Sección del material (artesa de 3 rodillos):
      b  = 0,9·B − 0,05                      (anchura útil, B en m)
      S1 = [l3 + (b − l3)·cos lambda]^2 · tg beta / 6
      S2 = [l3 + (b − l3)/2·cos lambda] · [(b − l3)/2·sen lambda]
      S  = S1 + S2                           [m2]   (l3: rodillo central)
3) Capacidad:            Qmáx = 3,6 · v · S · rho · K    [t/h]
   K según la inclinación (Tabla 1.1). Se elige el primer ancho normalizado
   con Qmáx >= Q (o la primera velocidad DIN si se ajusta v).
   Llenado = Q / Qmáx.
4) Carga lineal:         qg = Q / (3,6 · v)              [kg/m]
5) Fuerza periférica (método simplificado, L > 80 m):
      Fu = f · C·L · g · [ qR + (2·qb + qg)·cos delta ] + FS + qg · g · H   [N]
   - C: factor de longitud (interpolado según L en tablas.json).
   - FS: resistencias especiales (limpiadores...).
   - El último término es la fuerza para elevar el material.
   Con L <= 80 m se usa el método global (resistencia a resistencia).
6) Potencia:             Pu = Fu · v / 1000 [kW],   P = Pu / eta
   Par M = Fu · D/2   y giro n = 60 · v / (pi · D)
7) Tensiones (Euler-Eytelwein):
      T2 >= Fu / (e^(mu·theta) − 1)          (adherencia, theta en rad)
      T2 >= (qb + qg)·g·cos delta·l / (8·h_rel)    (flecha entre artesas)
      Se toma la mayor y se le suma un margen del 20 %.   T1 = T2 + Fu
8) Separación entre artesas (automática):
      l_máx = 8 · T2 · h_rel / [(qb + qg) · g · cos delta]
   Múltiplo de 5 cm, entre 1 y 1,5 m. Retorno: 2 a 3 veces la de artesas,
   como mucho 3 m.
9) Número de capas:      z >= S · T1 / (R · B[mm])
   S = 11 (3 a 5 capas), 12 (6 a 9) o 13 (más de 9); mínimo 3 capas.
   Se comprueba Tadm = R · z · B / S >= T1.

Ejemplo resuelto (datos por defecto)
------------------------------------
Datos: granito (rho = 1450 kg/m3, beta = 20°, clase C), Q = 250 t/h,
v = 2,09 m/s, L = 120 m, H = 6 m, artesa de 3 rodillos a 30°, se ajusta el
ancho. qb = 10 kg/m, qR = 15 kg/m, f = 0,02, limpiador 60 N, eta = 0,90,
D = 500 mm, mu = 0,30, theta = 200°, flecha 1 %, R = 160 N/mm.

1) delta = arcsen(6/120) = 2,87°  ->  cos delta = 0,99875
2-3) Capacidad por ancho (K = 0,996):
     B = 500 mm: b = 0,40 m, S = 0,02278 m2 -> Qmáx = 247,4 t/h < 250 -> no vale
     B = 600 mm: b = 0,49 m, S = 0,03395 m2 -> Qmáx = 368,8 t/h >= 250 -> VÁLIDO
   Ancho elegido: 600 mm. Llenado = 250 / 368,8 = 67,8 %.
4) qg = 250 / (3,6 · 2,09) = 33,23 kg/m
5) Para L = 120 m: C = 1,62  ->  C·L = 194,4 m
     Corchete = 15 + (2·10 + 33,23)·0,99875 = 68,16 kg/m
     Resistencias principales = 0,02 · 194,4 · 9,81 · 68,16 = 2599,73 N
     Resistencia por pendiente = 33,23 · 9,81 · 6 = 1955,74 N
     Fu = 2599,73 + 60 + 1955,74 = 4615,47 N
6) Pu = 4615,47 · 2,09 / 1000 = 9,65 kW  ->  P = 9,65 / 0,90 = 10,72 kW
   M = 4615,47 · 0,25 = 1153,87 N·m;  n = 79,8 rpm
7) e^(0,30 · 3,4907) = 2,8497
     T2 por adherencia = 4615,47 / 1,8497 = 2495,31 N (+20 % = 2994 N)
     Con 2994 N la flecha pediría artesas a 0,57 m: se ponen a 1,00 m y
     T2 por flecha = 43,23 · 9,81 · 0,99875 · 1,00 / (8 · 0,01) = 5294,08 N
     T2 = 5294,08 · 1,20 = 6352,90 N;   T1 = 6352,90 + 4615,47 = 10 968,37 N
     T1 / T2 = 1,727 < 2,850  ->  no desliza
8) Artesas a 1,00 m (flecha en cola 8,3 mm = 0,83 % <= 1 %);
   retorno a 2,40 m. Unas 120 estaciones de artesa en 120 m.
9) z >= 11 · 10 968,37 / (160 · 600) = 1,26  ->  mínimo constructivo: 3 capas
   Tadm = 160 · 3 · 600 / 11 = 26 182 N >= 10 968 N  ->  aprovechamiento 41,9 %

Resultado: banda de 600 mm a 2,09 m/s, motor de al menos 10,72 kW,
T1 = 10 968 N, artesas cada 1,00 m y banda EP 160 de 3 capas.
(Comprueba que la web da los mismos valores con los datos por defecto.)

La función calcular() se comprobó además con los ejemplos 1 a 15 de los
apuntes (selector «Datos de partida»): coinciden 81 de 82 resultados. La
única diferencia es una errata del ejemplo 6 (Tadm = 160·2·800/11 = 23 273 N,
no 32 000 N). Con «node pruebas.js» se repiten todas estas comprobaciones
(280 en total) y debe salir «0 fallos».

Actividades propuestas
----------------------
1. Mueve el deslizador del caudal de 150 a 1200 t/h: observa cómo salta el
   ancho (500, 600, 800... mm) y cómo cambian el llenado y la potencia.
2. Cambia «Para conseguirlo se ajusta» a la velocidad: con el mismo caudal,
   ¿qué velocidad DIN hace falta? ¿Supera la máxima de la Tabla 1.3?
3. Pon H = 0 (cinta horizontal) y compara la potencia con el ejemplo.
4. Pasa de 3 a 1 rodillo por estación: ¿qué ancho hace falta ahora?
5. Sube theta de 200° a 240°: ¿cómo cambian T2 y la separación de artesas?
6. Carga el ejemplo 10 y mueve theta hasta que el arco del tambor pase de
   rojo a verde (ocurre a 304,5°, el theta mínimo).
7. Añade un material nuevo en materiales.json y comprueba que aparece.
8. Añade un ejemplo nuevo en ejemplos.json copiando uno existente.

NOTA: es un modelo didáctico en régimen estacionario. No incluye arranque,
frenado, ondas elásticas ni varios tambores motrices. Las tablas proceden de
diapositivas escaneadas y algunas masas son aproximadas; un proyecto real
debe calcularse con la norma completa y datos de fabricante.
