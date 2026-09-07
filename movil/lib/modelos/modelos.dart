/// Los objetos que devuelve la API, tal cual los manda `server.js`.
///
/// Las fechas llegan como «AAAA-MM-DD HH:MM:SS» en UTC, sin zona: SQLite las
/// guarda así. Hay que marcarlas como UTC al leerlas o el móvil las daría por
/// locales y un mensaje de hace un minuto parecería de hace dos horas.
DateTime? fechaUtc(dynamic valor) {
  if (valor == null) return null;
  final texto = '$valor'.trim();
  if (texto.isEmpty) return null;
  return DateTime.tryParse(texto.replaceFirst(' ', 'T') + (texto.endsWith('Z') ? '' : 'Z'))
      ?.toLocal();
}

int? _entero(dynamic v) => v == null ? null : int.tryParse('$v');

class Usuario {
  Usuario({
    required this.id,
    required this.usuario,
    required this.nombre,
    required this.rol,
    this.grupoId,
    this.grupoNombre,
    this.email,
    this.locales = const [],
    this.puedeCrear = false,
  });

  final int id;
  final String usuario;
  final String nombre;
  final String rol;
  final int? grupoId;
  final String? grupoNombre;
  final String? email;
  final List<Catalogo> locales;
  final bool puedeCrear;

  bool get esTecnico => rol == 'tecnico';
  bool get esAdmin => rol == 'admin';
  bool get esGestor => rol == 'gestor';

  /// Quien puede cambiar estado, prioridad y asignación. Quien reporta la
  /// avería —empleado o usuario—, no.
  bool get gestiona => esTecnico || esGestor || esAdmin;

  factory Usuario.desdeJson(Map<String, dynamic> j) => Usuario(
        id: _entero(j['id']) ?? 0,
        usuario: '${j['usuario'] ?? ''}',
        nombre: '${j['nombre'] ?? ''}',
        rol: '${j['rol'] ?? 'empleado'}',
        grupoId: _entero(j['grupo_id']),
        grupoNombre: j['grupo_nombre'] as String?,
        email: j['email'] as String?,
        locales: Catalogo.lista(j['locales']),
        puedeCrear: j['puedeCrear'] == true,
      );
}

/// Un grupo o un local: id y nombre, que es todo lo que usan los desplegables.
class Catalogo {
  const Catalogo(this.id, this.nombre);

  final int id;
  final String nombre;

  factory Catalogo.desdeJson(Map<String, dynamic> j) =>
      Catalogo(_entero(j['id']) ?? 0, '${j['nombre'] ?? ''}');

  static List<Catalogo> lista(dynamic valor) => (valor as List? ?? [])
      .map((e) => Catalogo.desdeJson(e as Map<String, dynamic>))
      .toList();
}

/// Lo que `GET /api/meta` trae de una vez para llenar los desplegables.
class Meta {
  Meta({
    required this.grupos,
    required this.locales,
    required this.areas,
    required this.familias,
    required this.subfamilias,
    required this.empresas,
    required this.prendasLavanderia,
    required this.activos,
    required this.localesPropios,
    required this.tecnicos,
    required this.tecnicosInformes,
    required this.puedeCrear,
    required this.puedeProgramar,
    required this.puedeVerCalendario,
    required this.puedeVerInformes,
    required this.puedeUsarLavanderia,
    required this.puedeUsarInventario,
    required this.enNombreDe,
    required this.puedeAbrirEnNombreDe,
    this.tecnicoFijado,
  });

  final List<Catalogo> grupos;
  final List<Catalogo> locales;

  /// El grupo de la avería: la zona del local (Cocina, Sala, Barra…),
  /// obligatorio al abrir una incidencia. Cada familia cuelga de uno.
  final List<Catalogo> areas;

  /// La categoría de la avería dentro del grupo, obligatoria al abrir una
  /// incidencia.
  final List<Familia> familias;

  /// Con su familia, para recortar el desplegable según la familia elegida.
  final List<Subfamilia> subfamilias;

  /// Empresas con contrato de mantenimiento externo, para la tarea programada
  /// que marque «mantenimiento externo».
  final List<Catalogo> empresas;

  /// Las prendas que se pueden contar en un envío a lavandería.
  final List<Catalogo> prendasLavanderia;

  /// Los activos del inventario, para el desplegable opcional al abrir una
  /// incidencia. Con su departamento, para recortarlo según el elegido.
  final List<ActivoResumen> activos;

  /// Los locales en los que este usuario puede abrir incidencias, y también
  /// registrar lavandería.
  final List<Catalogo> localesPropios;
  final List<Tecnico> tecnicos;

  /// Quién aparece en el filtro de los informes. Un técnico solo se ve a sí
  /// mismo: los números de sus compañeros no son cosa suya.
  final List<Catalogo> tecnicosInformes;

  final bool puedeCrear;

  /// El programador de tareas lo llevan el gestor y el administrador.
  final bool puedeProgramar;

  /// El calendario es de solo lectura: también lo ve un técnico.
  final bool puedeVerCalendario;

  /// Los informes son para quien atiende o supervisa.
  final bool puedeVerInformes;

  /// La lavandería es cosa de quien trabaja en el local: todos menos el rol
  /// «usuario».
  final bool puedeUsarLavanderia;

  /// El inventario lo lleva quien gestiona incidencias.
  final bool puedeUsarInventario;

  /// A nombre de quién se puede abrir una incidencia. Vacía para quien no
  /// puede hacerlo.
  final List<Catalogo> enNombreDe;
  final bool puedeAbrirEnNombreDe;

  /// Si no es nulo, los informes están fijados a este técnico y el filtro no
  /// se puede cambiar. Lo decide el servidor, no la app.
  final int? tecnicoFijado;

  factory Meta.desdeJson(Map<String, dynamic> j) => Meta(
        grupos: Catalogo.lista(j['grupos']),
        locales: Catalogo.lista(j['locales']),
        areas: Catalogo.lista(j['areas']),
        familias: (j['familias'] as List? ?? [])
            .map((e) => Familia.desdeJson(e as Map<String, dynamic>))
            .toList(),
        subfamilias: (j['subfamilias'] as List? ?? [])
            .map((e) => Subfamilia.desdeJson(e as Map<String, dynamic>))
            .toList(),
        empresas: Catalogo.lista(j['empresas']),
        prendasLavanderia: Catalogo.lista(j['prendasLavanderia']),
        activos: (j['activos'] as List? ?? [])
            .map((e) => ActivoResumen.desdeJson(e as Map<String, dynamic>))
            .toList(),
        localesPropios: Catalogo.lista(j['localesPropios']),
        tecnicos: (j['tecnicos'] as List? ?? [])
            .map((e) => Tecnico.desdeJson(e as Map<String, dynamic>))
            .toList(),
        tecnicosInformes: Catalogo.lista(j['tecnicosInformes']),
        puedeCrear: j['puedeCrear'] == true,
        puedeProgramar: j['puedeProgramar'] == true,
        puedeVerCalendario: j['puedeVerCalendario'] == true,
        puedeVerInformes: j['puedeVerInformes'] == true,
        puedeUsarLavanderia: j['puedeUsarLavanderia'] == true,
        puedeUsarInventario: j['puedeUsarInventario'] == true,
        enNombreDe: Catalogo.lista(j['enNombreDe']),
        puedeAbrirEnNombreDe: j['puedeAbrirEnNombreDe'] == true,
        tecnicoFijado: _entero(j['tecnicoFijado']),
      );
}

/// Un técnico entre los que se reparte el trabajo. Lleva grupo porque una
/// incidencia solo se asigna a alguien de su mismo grupo.
class Tecnico {
  const Tecnico(this.id, this.nombre, this.grupoId);

  final int id;
  final String nombre;
  final int? grupoId;

  factory Tecnico.desdeJson(Map<String, dynamic> j) => Tecnico(
        _entero(j['id']) ?? 0,
        '${j['nombre'] ?? ''}',
        _entero(j['grupo_id']),
      );
}

/// Una familia entre las que ofrece el desplegable. Lleva grupo porque solo
/// tiene sentido dentro del suyo.
class Familia {
  const Familia(this.id, this.nombre, this.areaId);

  final int id;
  final String nombre;
  final int areaId;

  factory Familia.desdeJson(Map<String, dynamic> j) => Familia(
        _entero(j['id']) ?? 0,
        '${j['nombre'] ?? ''}',
        _entero(j['area_id']) ?? 0,
      );
}

/// Una subfamilia entre las que ofrece el desplegable. Lleva familia porque
/// solo tiene sentido dentro de la suya.
class Subfamilia {
  const Subfamilia(this.id, this.nombre, this.familiaId);

  final int id;
  final String nombre;
  final int familiaId;

  factory Subfamilia.desdeJson(Map<String, dynamic> j) => Subfamilia(
        _entero(j['id']) ?? 0,
        '${j['nombre'] ?? ''}',
        _entero(j['familia_id']) ?? 0,
      );
}

class Ticket {
  Ticket({
    required this.id,
    required this.titulo,
    this.descripcion,
    required this.estado,
    required this.prioridad,
    required this.grupoId,
    required this.grupoNombre,
    required this.localId,
    required this.localNombre,
    this.areaId,
    this.areaNombre,
    this.familiaId,
    this.familiaNombre,
    this.subfamiliaId,
    this.subfamiliaNombre,
    this.empresaNombre,
    this.activoId,
    this.activoNombre,
    this.asignadoA,
    this.asignadoNombre,
    this.creadoPor,
    this.creadorNombre,
    this.tareaNombre,
    this.creadoEn,
    this.actualizadoEn,
    this.mensajes = 0,
    this.adjuntos = 0,
    this.puedeGestionar = false,
    this.respuesta,
    this.hilo = const [],
    this.listaAdjuntos = const [],
  });

  final int id;
  final String titulo;
  final String? descripcion;
  final String estado;
  final String prioridad;
  final int grupoId;
  final String grupoNombre;
  final int localId;
  final String localNombre;

  /// El grupo (zona) y la familia de la avería.
  final int? areaId;
  final String? areaNombre;
  final int? familiaId;
  final String? familiaNombre;
  final int? subfamiliaId;
  final String? subfamiliaNombre;

  /// La empresa de mantenimiento externo, cuando la tarea que abrió la
  /// incidencia lo era.
  final String? empresaNombre;

  /// El activo del inventario que señala la incidencia, si lo trae.
  final int? activoId;
  final String? activoNombre;
  final int? asignadoA;
  final String? asignadoNombre;
  final int? creadoPor;
  final String? creadorNombre;

  /// Las incidencias que abre el programador no las crea nadie: en su lugar se
  /// enseña el nombre de la tarea.
  final String? tareaNombre;
  final DateTime? creadoEn;
  final DateTime? actualizadoEn;
  final int mensajes;
  final int adjuntos;
  final bool puedeGestionar;

  /// De quién es el turno, calculado por el servidor para quien mira:
  /// «respondido» si ha escrito el otro lado, «esperando» si escribió el mío.
  /// Nulo si no hay mensajes o la incidencia está cerrada.
  final String? respuesta;

  final List<Mensaje> hilo;
  final List<Adjunto> listaAdjuntos;

  bool get cerrado => estado == 'cerrado';
  bool get urgente => prioridad == 'urgente';

  String get abiertaPor => creadorNombre ?? tareaNombre ?? 'Tarea programada';

  factory Ticket.desdeJson(Map<String, dynamic> j) => Ticket(
        id: _entero(j['id']) ?? 0,
        titulo: '${j['titulo'] ?? ''}',
        descripcion: j['descripcion'] as String?,
        estado: '${j['estado'] ?? 'abierto'}',
        prioridad: '${j['prioridad'] ?? 'normal'}',
        grupoId: _entero(j['grupo_id']) ?? 0,
        grupoNombre: '${j['grupo_nombre'] ?? ''}',
        localId: _entero(j['local_id']) ?? 0,
        localNombre: '${j['local_nombre'] ?? ''}',
        areaId: _entero(j['area_id']),
        areaNombre: j['area_nombre'] as String?,
        familiaId: _entero(j['familia_id']),
        familiaNombre: j['familia_nombre'] as String?,
        subfamiliaId: _entero(j['subfamilia_id']),
        subfamiliaNombre: j['subfamilia_nombre'] as String?,
        empresaNombre: j['empresa_nombre'] as String?,
        activoId: _entero(j['activo_id']),
        activoNombre: j['activo_nombre'] as String?,
        asignadoA: _entero(j['asignado_a']),
        asignadoNombre: j['asignado_nombre'] as String?,
        creadoPor: _entero(j['creado_por']),
        creadorNombre: j['creador_nombre'] as String?,
        tareaNombre: j['tarea_nombre'] as String?,
        creadoEn: fechaUtc(j['creado_en']),
        actualizadoEn: fechaUtc(j['actualizado_en']),
        mensajes: _entero(j['mensajes']) ?? 0,
        adjuntos: _entero(j['adjuntos']) ?? 0,
        puedeGestionar: j['puedeGestionar'] == true,
        respuesta: j['respuesta'] as String?,
        hilo: (j['mensajes_hilo'] as List? ?? [])
            .map((e) => Mensaje.desdeJson(e as Map<String, dynamic>))
            .toList(),
        listaAdjuntos: (j['adjuntos_lista'] as List? ?? [])
            .map((e) => Adjunto.desdeJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class Mensaje {
  Mensaje({
    required this.id,
    required this.contenido,
    required this.autorId,
    required this.autorNombre,
    required this.autorRol,
    this.creadoEn,
    this.apertura = false,
  });

  final int id;
  final String contenido;
  final int autorId;
  final String autorNombre;
  final String autorRol;
  final DateTime? creadoEn;

  /// El mensaje con el que se abrió la incidencia: lleva su descripción y los
  /// adjuntos que se mandaron al crearla.
  final bool apertura;

  factory Mensaje.desdeJson(Map<String, dynamic> j) => Mensaje(
        id: _entero(j['id']) ?? 0,
        contenido: '${j['contenido'] ?? ''}',
        autorId: _entero(j['autor_id']) ?? 0,
        autorNombre: '${j['autor_nombre'] ?? ''}',
        autorRol: '${j['autor_rol'] ?? ''}',
        creadoEn: fechaUtc(j['creado_en']),
        apertura: j['apertura'] == 1 || j['apertura'] == true,
      );
}

class Adjunto {
  Adjunto({
    required this.id,
    required this.nombre,
    required this.tipo,
    this.mensajeId,
    this.subidoPor,
    this.autorNombre,
    this.creadoEn,
  });

  final int id;
  final String nombre;

  /// «imagen», «video» o «documento».
  final String tipo;
  final int? mensajeId;
  final int? subidoPor;
  final String? autorNombre;
  final DateTime? creadoEn;

  bool get esImagen => tipo == 'imagen';
  bool get esVideo => tipo == 'video';

  factory Adjunto.desdeJson(Map<String, dynamic> j) => Adjunto(
        id: _entero(j['id']) ?? 0,
        nombre: '${j['nombre'] ?? ''}',
        tipo: '${j['tipo'] ?? 'documento'}',
        mensajeId: _entero(j['mensaje_id']),
        subidoPor: _entero(j['subido_por']),
        autorNombre: j['autor_nombre'] as String?,
        creadoEn: fechaUtc(j['creado_en']),
      );
}

/// Una empresa de mantenimiento externo, tal y como la ve el administrador en
/// `/api/empresas`. En el resto de la app, donde solo hace falta el nombre
/// para un desplegable, se usa `Catalogo`.
class Empresa {
  Empresa({
    required this.id,
    required this.nombre,
    this.contacto,
    this.telefono,
    this.email,
    this.notas,
    this.tareas = 0,
  });

  final int id;
  final String nombre;
  final String? contacto;
  final String? telefono;
  final String? email;
  final String? notas;

  /// Cuántas tareas programadas se la asignan.
  final int tareas;

  factory Empresa.desdeJson(Map<String, dynamic> j) => Empresa(
        id: _entero(j['id']) ?? 0,
        nombre: '${j['nombre'] ?? ''}',
        contacto: j['contacto'] as String?,
        telefono: j['telefono'] as String?,
        email: j['email'] as String?,
        notas: j['notas'] as String?,
        tareas: _entero(j['tareas']) ?? 0,
      );
}

/// Una cuenta, tal y como la ve el administrador en `/api/usuarios`.
class Cuenta {
  Cuenta({
    required this.id,
    required this.usuario,
    required this.nombre,
    required this.rol,
    this.grupoId,
    this.grupoNombre,
    this.email,
    this.locales = const [],
    this.bloqueada = false,
    this.suspendida = false,
    this.entra = false,
  });

  final int id;
  final String usuario;
  final String nombre;
  final String rol;
  final int? grupoId;
  final String? grupoNombre;

  /// El correo con el que entra. Las cuentas antiguas pueden no tenerlo.
  final String? email;

  final List<Catalogo> locales;

  /// La bloquea el servidor tras diez intentos fallidos; solo la levanta un
  /// administrador.
  final bool bloqueada;

  /// La suspende un administrador, a mano. No es lo mismo que `bloqueada`, y
  /// por eso son dos: aquella la pone la máquina y se limpia al reactivar el
  /// acceso; esta la decide una persona y solo una persona la quita.
  final bool suspendida;

  /// Si entra con la cuenta de Office 365 del grupo.
  final bool entra;

  factory Cuenta.desdeJson(Map<String, dynamic> j) => Cuenta(
        id: _entero(j['id']) ?? 0,
        usuario: '${j['usuario'] ?? ''}',
        nombre: '${j['nombre'] ?? ''}',
        rol: '${j['rol'] ?? 'empleado'}',
        grupoId: _entero(j['grupo_id']),
        grupoNombre: j['grupo_nombre'] as String?,
        email: j['email'] as String?,
        locales: Catalogo.lista(j['locales']),
        bloqueada: j['bloqueada'] == 1 || j['bloqueada'] == true,
        suspendida: j['suspendida'] == 1 || j['suspendida'] == true,
        entra: j['entra'] == 1 || j['entra'] == true,
      );
}

/// Una tarea del programador.
class Tarea {
  Tarea({
    required this.id,
    required this.nombre,
    required this.frecuencia,
    required this.hora,
    required this.fechaInicio,
    required this.cada,
    this.diasSemana,
    this.diasMes,
    this.meses,
    required this.plantillaTitulo,
    this.plantillaDescripcion,
    required this.grupoId,
    required this.grupoNombre,
    this.localId,
    this.localNombre,
    required this.prioridad,
    required this.activo,
    this.mantenimientoExterno = false,
    this.empresaId,
    this.empresaNombre,
    this.areaId,
    this.areaNombre,
    this.familiaId,
    this.familiaNombre,
    this.proximaTexto,
    this.tickets = 0,
  });

  final int id;
  final String nombre;

  /// «una_vez», «diaria», «semanal» o «mensual».
  final String frecuencia;
  final String hora;
  final String fechaInicio;
  final int cada;

  /// «1,3,5»; el domingo es 0.
  final String? diasSemana;
  final String? diasMes;

  /// Nulo quiere decir todos los meses.
  final String? meses;

  final String plantillaTitulo;
  final String? plantillaDescripcion;
  final int grupoId;
  final String grupoNombre;

  /// Sin local, la tarea abre una incidencia por cada local.
  final int? localId;
  final String? localNombre;
  final String prioridad;
  final bool activo;

  /// Si la lleva una empresa externa en vez del propio personal.
  final bool mantenimientoExterno;
  final int? empresaId;
  final String? empresaNombre;

  /// El equipo que mantiene, para el calendario; opcional.
  final int? areaId;
  final String? areaNombre;
  final int? familiaId;
  final String? familiaNombre;

  /// Cuándo le toca la próxima vez, ya redactado por el servidor en la zona de
  /// la aplicación. Sin esto no hay forma de saber si una tarea recién creada
  /// va a hacer algo.
  final String? proximaTexto;

  /// Cuántas incidencias lleva abiertas.
  final int tickets;

  factory Tarea.desdeJson(Map<String, dynamic> j) => Tarea(
        id: _entero(j['id']) ?? 0,
        nombre: '${j['nombre'] ?? ''}',
        frecuencia: '${j['frecuencia'] ?? 'diaria'}',
        hora: '${j['hora'] ?? '09:00'}',
        fechaInicio: '${j['fecha_inicio'] ?? ''}',
        cada: _entero(j['cada']) ?? 1,
        diasSemana: j['dias_semana'] as String?,
        diasMes: j['dias_mes'] as String?,
        meses: j['meses'] as String?,
        plantillaTitulo: '${j['plantilla_titulo'] ?? ''}',
        plantillaDescripcion: j['plantilla_descripcion'] as String?,
        grupoId: _entero(j['grupo_id']) ?? 0,
        grupoNombre: '${j['grupo_nombre'] ?? ''}',
        localId: _entero(j['local_id']),
        localNombre: j['local_nombre'] as String?,
        prioridad: '${j['prioridad'] ?? 'normal'}',
        activo: j['activo'] == 1 || j['activo'] == true,
        mantenimientoExterno: j['mantenimiento_externo'] == 1 || j['mantenimiento_externo'] == true,
        empresaId: _entero(j['empresa_id']),
        empresaNombre: j['empresa_nombre'] as String?,
        areaId: _entero(j['area_id']),
        areaNombre: j['area_nombre'] as String?,
        familiaId: _entero(j['familia_id']),
        familiaNombre: j['familia_nombre'] as String?,
        proximaTexto: j['proxima_texto'] as String?,
        tickets: _entero(j['tickets']) ?? 0,
      );
}

/// Lo que devuelve `/api/informes` para el rango pedido.
class Informe {
  Informe({
    required this.locales,
    required this.areas,
    required this.familias,
    required this.lavanderia,
    required this.meses,
    required this.abiertas,
    required this.pendientes,
    required this.cerradas,
    required this.entrados,
    required this.resueltos,
    required this.sinCerrar,
    required this.tecnicos,
  });

  final List<FilaDesglose> locales;

  /// Mismo desglose, por grupo. Solo entran las incidencias categorizadas.
  final List<FilaDesglose> areas;

  /// Mismo desglose, por familia. Solo entran las incidencias categorizadas.
  final List<FilaDesglose> familias;

  /// Enviado, recibido y merma por prenda, en el mismo rango de fechas.
  final List<FilaLavanderia> lavanderia;

  /// Entradas por mes, «AAAA-MM» → cuántas.
  final List<MapEntry<String, int>> meses;

  final int abiertas;
  final int pendientes;
  final int cerradas;

  final int entrados;
  final int resueltos;

  /// De las entradas del rango, las que siguen sin cerrar.
  final int sinCerrar;

  /// Quién puede salir en «gestionada por», ya recortado por el servidor al
  /// grupo y al local que se están mirando.
  final List<Catalogo> tecnicos;

  factory Informe.desdeJson(Map<String, dynamic> j) {
    final total = (j['total'] as Map<String, dynamic>?) ?? const {};
    final estado = (j['estado'] as Map<String, dynamic>?) ?? const {};
    return Informe(
      locales: (j['locales'] as List? ?? [])
          .map((e) => FilaDesglose.desdeJson(e as Map<String, dynamic>))
          .toList(),
      areas: (j['areas'] as List? ?? [])
          .map((e) => FilaDesglose.desdeJson(e as Map<String, dynamic>))
          .toList(),
      familias: (j['familias'] as List? ?? [])
          .map((e) => FilaDesglose.desdeJson(e as Map<String, dynamic>))
          .toList(),
      lavanderia: (j['lavanderia'] as List? ?? [])
          .map((e) => FilaLavanderia.desdeJson(e as Map<String, dynamic>))
          .toList(),
      meses: (j['meses'] as List? ?? []).map((e) {
        final m = e as Map<String, dynamic>;
        return MapEntry('${m['mes'] ?? ''}', _entero(m['entrados']) ?? 0);
      }).toList(),
      abiertas: _entero(estado['abiertas']) ?? 0,
      pendientes: _entero(estado['pendientes']) ?? 0,
      cerradas: _entero(estado['cerradas']) ?? 0,
      entrados: _entero(total['entrados']) ?? 0,
      resueltos: _entero(total['resueltos']) ?? 0,
      sinCerrar: _entero(total['pendientes']) ?? 0,
      tecnicos: Catalogo.lista(j['tecnicos']),
    );
  }
}

/// Lo que devuelve `GET /api/calendario?anio=` sin `mes`: por cada mes del
/// año, qué días tienen alguna tarea (para las minirrejillas del año) y
/// cuántas tareas distintas le tocan.
class MesCalendario {
  const MesCalendario({required this.mes, required this.dias, required this.tareas});

  /// De 1 (enero) a 12 (diciembre).
  final int mes;

  /// Días del mes, 1-indexados, en los que cae alguna tarea.
  final List<int> dias;

  /// Cuántas tareas distintas tienen alguna ocurrencia este mes.
  final int tareas;

  factory MesCalendario.desdeJson(Map<String, dynamic> j) => MesCalendario(
        mes: _entero(j['mes']) ?? 1,
        dias: (j['dias'] as List? ?? []).map((d) => _entero(d) ?? 0).toList(),
        tareas: _entero(j['tareas']) ?? 0,
      );
}

/// Una tarea programada que cae en un día concreto, tal y como la trae
/// `GET /api/calendario?anio=&mes=` dentro de `dias`.
class EventoCalendario {
  const EventoCalendario({
    required this.id,
    required this.nombre,
    required this.plantillaTitulo,
    required this.hora,
    required this.mantenimientoExterno,
    required this.estado,
    this.grupoNombre,
    this.localNombre,
    this.areaNombre,
    this.familiaNombre,
    this.empresaNombre,
  });

  final int id;
  final String nombre;
  final String plantillaTitulo;
  final String hora;
  final bool mantenimientoExterno;

  /// «cerrada» si las incidencias que abrió ese día ya están resueltas,
  /// «atrasada» si el día ya pasó y no es así, «pendiente» si es hoy, o
  /// «programada» si todavía no ha llegado.
  final String estado;
  final String? grupoNombre;
  final String? localNombre;
  final String? areaNombre;
  final String? familiaNombre;
  final String? empresaNombre;

  bool get cerrada => estado == 'cerrada';
  bool get atrasada => estado == 'atrasada';

  factory EventoCalendario.desdeJson(Map<String, dynamic> j) => EventoCalendario(
        id: _entero(j['id']) ?? 0,
        nombre: '${j['nombre'] ?? ''}',
        plantillaTitulo: '${j['plantilla_titulo'] ?? ''}',
        hora: '${j['hora'] ?? ''}',
        mantenimientoExterno: j['mantenimiento_externo'] == 1 || j['mantenimiento_externo'] == true,
        estado: '${j['estado'] ?? 'programada'}',
        grupoNombre: j['grupo_nombre'] as String?,
        localNombre: j['local_nombre'] as String?,
        areaNombre: j['area_nombre'] as String?,
        familiaNombre: j['familia_nombre'] as String?,
        empresaNombre: j['empresa_nombre'] as String?,
      );
}

/// Una línea del desglose por local o por familia: mismas columnas en los dos.
class FilaDesglose {
  const FilaDesglose({
    required this.nombre,
    required this.entrados,
    required this.resueltos,
    required this.pendientes,
  });

  final String nombre;
  final int entrados;
  final int resueltos;
  final int pendientes;

  factory FilaDesglose.desdeJson(Map<String, dynamic> j) => FilaDesglose(
        nombre: '${j['nombre'] ?? ''}',
        entrados: _entero(j['entrados']) ?? 0,
        resueltos: _entero(j['resueltos']) ?? 0,
        pendientes: _entero(j['pendientes']) ?? 0,
      );
}

/// Una línea del desglose de lavandería, por prenda.
class FilaLavanderia {
  const FilaLavanderia({
    required this.id,
    required this.nombre,
    required this.enviado,
    required this.recibido,
    required this.merma,
    required this.pendiente,
  });

  final int id;
  final String nombre;
  final int enviado;

  /// Solo cuenta lo de los envíos ya contados a la vuelta.
  final int recibido;

  /// `enviado - recibido` de los envíos ya contados; nunca de los pendientes.
  final int merma;

  /// Enviado en envíos que todavía no han vuelto.
  final int pendiente;

  factory FilaLavanderia.desdeJson(Map<String, dynamic> j) => FilaLavanderia(
        id: _entero(j['id']) ?? 0,
        nombre: '${j['nombre'] ?? ''}',
        enviado: _entero(j['enviado']) ?? 0,
        recibido: _entero(j['recibido']) ?? 0,
        merma: _entero(j['merma']) ?? 0,
        pendiente: _entero(j['pendiente']) ?? 0,
      );
}

/// Una prenda dentro de un envío a lavandería, con lo enviado y, si ya volvió,
/// lo recibido.
class ItemLavanderia {
  const ItemLavanderia({
    required this.prendaId,
    required this.prendaNombre,
    required this.enviado,
    this.recibido,
  });

  final int prendaId;
  final String prendaNombre;
  final int enviado;

  /// Nulo hasta que se cuenta la vuelta.
  final int? recibido;

  /// `enviado - recibido`, o nulo mientras no se ha contado la vuelta.
  int? get merma => recibido == null ? null : enviado - recibido!;

  factory ItemLavanderia.desdeJson(Map<String, dynamic> j) => ItemLavanderia(
        prendaId: _entero(j['prenda_id']) ?? 0,
        prendaNombre: '${j['prenda_nombre'] ?? ''}',
        enviado: _entero(j['enviado']) ?? 0,
        recibido: _entero(j['recibido']),
      );
}

/// Un envío a lavandería, con sus prendas, tal y como lo trae `/api/lavanderia`.
class EnvioLavanderia {
  const EnvioLavanderia({
    required this.id,
    required this.localId,
    required this.localNombre,
    required this.creadoPorNombre,
    required this.creadoEn,
    required this.items,
    this.notas,
    this.recibidoEn,
    this.recibidoPorNombre,
    this.notasRecepcion,
  });

  final int id;
  final int localId;
  final String localNombre;
  final String creadoPorNombre;
  final DateTime? creadoEn;
  final String? notas;
  final List<ItemLavanderia> items;

  /// Nulo mientras no ha vuelto de la lavandería.
  final DateTime? recibidoEn;
  final String? recibidoPorNombre;
  final String? notasRecepcion;

  bool get pendiente => recibidoEn == null;

  factory EnvioLavanderia.desdeJson(Map<String, dynamic> j) => EnvioLavanderia(
        id: _entero(j['id']) ?? 0,
        localId: _entero(j['local_id']) ?? 0,
        localNombre: '${j['local_nombre'] ?? ''}',
        creadoPorNombre: '${j['creado_por_nombre'] ?? ''}',
        creadoEn: fechaUtc(j['creado_en']),
        notas: j['notas'] as String?,
        items: (j['items'] as List? ?? [])
            .map((e) => ItemLavanderia.desdeJson(e as Map<String, dynamic>))
            .toList(),
        recibidoEn: fechaUtc(j['recibido_en']),
        recibidoPorNombre: j['recibido_por_nombre'] as String?,
        notasRecepcion: j['notas_recepcion'] as String?,
      );
}

/// Un activo del inventario, tal y como aparece en `meta.activos`: lo justo
/// para el desplegable opcional al abrir una incidencia.
class ActivoResumen {
  const ActivoResumen({
    required this.id,
    required this.nombre,
    required this.estado,
    required this.localId,
    required this.grupoId,
  });

  final int id;
  final String nombre;
  final String estado;
  final int localId;
  final int grupoId;

  factory ActivoResumen.desdeJson(Map<String, dynamic> j) => ActivoResumen(
        id: _entero(j['id']) ?? 0,
        nombre: '${j['nombre'] ?? ''}',
        estado: '${j['estado'] ?? 'en_uso'}',
        localId: _entero(j['local_id']) ?? 0,
        grupoId: _entero(j['grupo_id']) ?? 0,
      );
}

/// Una incidencia dentro del historial de un activo: lo justo para listarla,
/// tal y como la trae `GET /api/activos/:id`.
class IncidenciaDeActivo {
  const IncidenciaDeActivo({
    required this.id,
    required this.titulo,
    required this.estado,
    required this.creadoEn,
  });

  final int id;
  final String titulo;
  final String estado;
  final DateTime? creadoEn;

  factory IncidenciaDeActivo.desdeJson(Map<String, dynamic> j) => IncidenciaDeActivo(
        id: _entero(j['id']) ?? 0,
        titulo: '${j['titulo'] ?? ''}',
        estado: '${j['estado'] ?? 'abierto'}',
        creadoEn: fechaUtc(j['creado_en']),
      );
}

/// La ficha completa de un activo, tal y como la trae `GET /api/activos/:id`:
/// con su historial de incidencias, calculado al vuelo por el servidor a
/// partir de las incidencias que lo señalan (no se guarda aparte).
class Activo {
  const Activo({
    required this.id,
    required this.nombre,
    this.descripcion,
    required this.estado,
    required this.localId,
    required this.localNombre,
    required this.grupoId,
    required this.grupoNombre,
    this.foto,
    required this.incidencias,
  });

  final int id;
  final String nombre;
  final String? descripcion;
  final String estado;
  final int localId;
  final String localNombre;
  final int grupoId;
  final String grupoNombre;
  final String? foto;
  final List<IncidenciaDeActivo> incidencias;

  factory Activo.desdeJson(Map<String, dynamic> j) => Activo(
        id: _entero(j['id']) ?? 0,
        nombre: '${j['nombre'] ?? ''}',
        descripcion: j['descripcion'] as String?,
        estado: '${j['estado'] ?? 'en_uso'}',
        localId: _entero(j['local_id']) ?? 0,
        localNombre: '${j['local_nombre'] ?? ''}',
        grupoId: _entero(j['grupo_id']) ?? 0,
        grupoNombre: '${j['grupo_nombre'] ?? ''}',
        foto: j['foto'] as String?,
        incidencias: (j['incidencias'] as List? ?? [])
            .map((e) => IncidenciaDeActivo.desdeJson(e as Map<String, dynamic>))
            .toList(),
      );
}
