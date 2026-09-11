Reto corporativo: Inteligencia de Base Instalada de Clientes Presentado por Philips
$1,500
Construye un prototipo que convierta lo que un colaborador de campo observa en un hospital en datos estructurados y confiables sobre los equipos instalados, con captura tan simple como una conversación y con la inferencia corriendo en el dispositivo.

El problema Ingenieros de servicio, vendedores y especialistas visitan hospitales y clínicas todos los días. Ven cuántos resonadores, tomógrafos o ecógrafos tiene cada cliente, de qué marca y qué tan antiguos parecen. Hoy ese conocimiento se queda en notas personales, conversaciones o memoria: capturarlo a mano toma tiempo, las descripciones son inconsistentes, varias personas reportan el mismo equipo y las observaciones suelen ser parciales. El resultado es una organización con poca visibilidad del panorama tecnológico real de sus clientes.

Por qué en el dispositivo El colaborador está dentro de un hospital, con frecuencia sin conectividad estable, y lo que ve es información sensible del cliente. La captura y la extracción deben funcionar sin internet y sin enviar el contenido a un servicio externo. Eso es exactamente lo que QVAC permite.

Tu misión Después de una visita, el colaborador abre la aplicación y dice o escribe algo como:

"Estoy en Hospital DemoCare Pacific, en Panamy un tomógrafo. Uno de los resonadores parece de

Metas adicionales Dictado por voz al terminar la visita. Detecciórvaciones. Puntaje de confianza según completitud, antigüedad y confirmaciones indepemación no verificada recientemente. Preguntas de seguimiento automáticas por el dato faltante más valioso. Consultas en lenguaje natural sobre el dataset ("clientes en Brasil con resonadores de más de siete años"). Identificación de oportunidades de renovación. Captura asistida por foto de etiquetas o placas, sujeta a las capacidadesonible.

Requisito técnico obligatorio La solución debe usar QVAC con inferencia en eler-to-peer. Las soluciones que envíen lainferencia a una API en la nube no califican para este reto ni para el ranking general, sin importar la calidad del resultado. ISD verifica este requisito antes deips. La interfaz (app móvil, escritorio,chatbot, asistente de voz) es libre.

Construye un prototipo que convierta lo que un colaborador de campo observa en un hospital en datos estructurados y confiables sobre los equipos instalados, con captura tan simple como una conversación y con la inferencia corriendo en el dispositivo.

El problema Ingenieros de servicio, vendedores y especialislínicas todos los días. Ven cuántos resonadores,tomógrafos o ecógrafos tiene cada cliente, de qué marca y qué tan antiguos parecen. Hoy ese conocimiento se queda en notas personales, conversaciones o memoria: capturarldescripciones son inconsistentes, variaspersonas reportan el mismo equipo y las observaciones suelen ser parciales. El resultado es una organización con poca visibilidad del panorama tecnológico real de su

Por qué en el dispositivo El colaborador está dentro de un hospital, con d estable, y lo que ve es información sensibledel cliente. La captura y la extracción deben funcionar sin internet y sin enviar el contenido a un servicio externo. Eso es exactamente lo que QVAC permite.

Tu misión Después de una visita, el colaborador abre la aplicación y dice o escribe algo como:

"Estoy en Hospital DemoCare Pacific, en Panamy un tomógrafo. Uno de los resonadores parece deunos ocho años."

El prototipo debe interpretar el mensaje, extraer cliente, ciudad, país, modalidad, cantidad, marca, modelo y antigüedad cuando se conozcan, preguntar por lo que falta,dos y guardar la observación en un repositorio estructurado. Con el tiempo, esas observacionesna vista viva de la base instalada por cliente ypor geografía.

Prototipo mínimo

Captura en lenguaje natural de una observació
Extracción con IA de la información estructurada del equipo, tolerando datos incompletos.
Almacenamiento en un dataset estructurado, con estado por observación: Confirmado, Reportado, Estimado o Desconocido.
Vista de base instalada a nivel de cliente.
Agregación o visualización básica entre varios clientes.
Metas adicionales

Dictado por voz al terminar la visita.
Detección de duplicados entre observaciones.
Puntaje de confianza según completitud, antigüedad y confirmaciones independientes.
Alertas de información no verificada recientemente.
Preguntas de seguimiento automáticas por el d
Consultas en lenguaje natural sobre el dataset ("clientes en Brasil con resonadores de más de siete años").
Identificación de oportunidades de renovación.
Captura asistida por foto de etiquetas o placas, sujeta a las capacidades del modelo de visión disponible.
Requisito técnico obligatorio La solución debe usar QVAC con inferencia en el dispositivo o delegada peer-to-peer. Las soluciones que envíen la inferencia a una API en la nube **no califican*l ranking general, sin importar la calidad delresultado. ISD verifica este requisito antes de pasar las entregas a Philips. La interfaz (app móvil, escritorio, chatbot, asistente de voz) es libre.

Tres decisiones, todas por cómo renderiza el componente:

Secciones en negrita, no en ##. TrackDeta estilos para h1–h3, así que el preflight deTailwind los deja del tamaño del texto normal: un heading se vería idéntico a un párrafo. La negrita sí está estilada ([&amp;_strong]:font-bold).
"En una frase" desaparece como etiqueta y la frase se vuelve el primer párrafo con la parte accionable en negrita. TrackCard corta a 5 líneas (line-clamp-5), así que lo primero es lo único que se ve en la card — gastar esa línea en un rótulo la desperdicia.
El ejemplo va como &gt; blockquote — estilado enel dialog ni en la card, donde caerá al defaultdel navegador (margen + sin borde). Si lo prefieres consistente, cámbialo a cursiva; lo dejé como cita porque separa mejor la voz del usuario.
Los Confirmado/Reportado en backticks solo se ven como código en el dialog si hay estilo de code — ahí tampoco lo hay, así que se verán como texto plano. Quítalos si te molesta la inconsistencia.



&nbsp;

&nbsp;