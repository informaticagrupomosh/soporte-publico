import 'dart:async';

import 'package:flutter/material.dart';

import '../app.dart';
import '../modelos/modelos.dart';
import '../nucleo/api.dart';
import '../nucleo/formato.dart';
import '../nucleo/sesion.dart';
import '../nucleo/tema.dart';
import '../servicios/privacidad.dart';
import '../widgets/etiquetas.dart';
import '../widgets/tarjeta.dart';
import 'calendario.dart';
import 'catalogos.dart';
import 'catalogos_empresas.dart';
import 'catalogos_familias.dart';
import 'chat.dart';
import 'detalle.dart';
import 'informes.dart';
import 'inventario.dart';
import 'lavanderia.dart';
import 'nueva.dart';
import 'tareas.dart';
import 'usuarios.dart';

/// La lista que ve cada usuario según su rol. El servidor ya decide qué
/// incidencias le tocan; aquí solo se filtra y se ordena lo que manda.
class ListaTickets extends StatefulWidget {
  const ListaTickets({super.key});

  @override
  State<ListaTickets> createState() => _ListaTicketsState();
}

class _ListaTicketsState extends State<ListaTickets> with WidgetsBindingObserver {
  final _buscador = TextEditingController();

  List<Ticket> _tickets = [];
  bool _cargando = true;
  String? _error;

  // Filtros, con el mismo criterio que la web: sin valor, no filtra.
  int? _grupoId;
  int? _localId;
  int? _areaId;
  int? _familiaId;
  int? _subfamiliaId;
  String? _estado;
  String? _prioridad;
  String? _asignado;

  bool _completadosAbiertos = false;
  Timer? _reloj;
  Timer? _rebote;

  /// Se refresca sola, como la web. La lista es lo que la gente deja abierto en
  /// el mostrador, así que tiene que enterarse sin que nadie la toque.
  static const _cada = Duration(seconds: 20);

  bool _iniciado = false;

  /// La primera carga va aquí y no en `initState`: leer la sesión necesita el
  /// `InheritedWidget` de encima, que todavía no está disponible allí.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_iniciado) return;
    _iniciado = true;
    WidgetsBinding.instance.addObserver(this);
    _cargar();
    _reloj = Timer.periodic(_cada, (_) => _cargar(silencioso: true));
  }

  // Al volver del segundo plano no hace falta esperar al siguiente tic: quien
  // ha dejado el móvil un rato quiere ver de un vistazo si ha entrado algo.
  @override
  void didChangeAppLifecycleState(AppLifecycleState estado) {
    if (estado == AppLifecycleState.resumed) _cargar(silencioso: true);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _reloj?.cancel();
    _rebote?.cancel();
    _buscador.dispose();
    super.dispose();
  }

  Future<void> _cargar({bool silencioso = false}) async {
    if (!silencioso) setState(() => _cargando = true);

    final api = SesionScope.de(context).api;
    try {
      final datos = await api.get('/api/tickets', {
        'grupo_id': _grupoId,
        'local_id': _localId,
        'area_id': _areaId,
        'familia_id': _familiaId,
        'subfamilia_id': _subfamiliaId,
        'estado': _estado,
        'prioridad': _prioridad,
        'asignado': _asignado,
        'q': _buscador.text.trim(),
      }) as List;

      if (!mounted) return;
      setState(() {
        _tickets = datos
            .map((e) => Ticket.desdeJson(e as Map<String, dynamic>))
            .toList();
        _error = null;
        _cargando = false;
      });
    } on ErrorApi catch (e) {
      if (!mounted) return;
      // Un fallo del refresco automático no borra lo que ya se está viendo.
      setState(() {
        _cargando = false;
        if (!silencioso || _tickets.isEmpty) _error = e.mensaje;
      });
    }
  }

  /// El buscador espera a que se deje de escribir: una petición por letra
  /// sobraría.
  void _buscarConRebote() {
    _rebote?.cancel();
    _rebote = Timer(const Duration(milliseconds: 400), () => _cargar(silencioso: true));
  }

  bool get _hayFiltros =>
      _grupoId != null || _localId != null || _areaId != null ||
      _familiaId != null || _subfamiliaId != null || _estado != null ||
      _prioridad != null || _asignado != null;

  void _limpiarFiltros() {
    setState(() {
      _grupoId = null;
      _localId = null;
      _areaId = null;
      _familiaId = null;
      _subfamiliaId = null;
      _estado = null;
      _prioridad = null;
      _asignado = null;
    });
    _cargar();
  }

  Future<void> _abrir(Ticket ticket) async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => DetalleTicket(ticketId: ticket.id)),
    );
    // Al volver puede haber cambiado el estado o haber mensajes nuevos.
    if (mounted) _cargar(silencioso: true);
  }

  Future<void> _nueva() async {
    final creada = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const NuevaIncidencia()),
    );
    if (creada == true && mounted) _cargar();
  }

  @override
  Widget build(BuildContext context) {
    final sesion = SesionScope.de(context);
    final usuario = sesion.usuario;

    // Lo cerrado se aparta abajo, plegado: arriba queda solo lo que falta por
    // hacer, que es el criterio de la web.
    final pendientes = _tickets.where((t) => !t.cerrado).toList();
    final completados = _tickets.where((t) => t.cerrado).toList();

    return Scaffold(
      drawer: _menu(sesion, usuario),
      appBar: AppBar(
        title: const Text('Incidencias'),
        actions: [
          IconButton(
            tooltip: 'Filtros',
            onPressed: _abrirFiltros,
            icon: Badge(
              isLabelVisible: _hayFiltros,
              backgroundColor: Tema.azul,
              child: const Icon(Icons.filter_list),
            ),
          ),
          PopupMenuButton<String>(
            onSelected: (v) {
              if (v == 'salir') sesion.salir();
            },
            itemBuilder: (_) => [
              PopupMenuItem(
                enabled: false,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(usuario?.nombre ?? '',
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text(
                      _rolLegible(usuario),
                      style: const TextStyle(fontSize: 12, color: Tema.gris),
                    ),
                  ],
                ),
              ),
              const PopupMenuDivider(),
              const PopupMenuItem(
                value: 'salir',
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.logout, size: 20),
                  title: Text('Cerrar sesión'),
                ),
              ),
            ],
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(58),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
            child: TextField(
              controller: _buscador,
              onChanged: (_) => _buscarConRebote(),
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: 'Buscar por título, local, persona…',
                prefixIcon: const Icon(Icons.search, size: 20),
                isDense: true,
                suffixIcon: _buscador.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: () {
                          _buscador.clear();
                          _cargar(silencioso: true);
                        },
                      ),
              ),
            ),
          ),
        ),
      ),
      floatingActionButton: sesion.puedeCrear
          ? FloatingActionButton.extended(
              onPressed: _nueva,
              icon: const Icon(Icons.add),
              label: const Text('Nueva'),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: _cargar,
        child: _cuerpo(pendientes, completados),
      ),
    );
  }

  Widget _cuerpo(List<Ticket> pendientes, List<Ticket> completados) {
    if (_cargando && _tickets.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null && _tickets.isEmpty) {
      return ListView(
        children: [
          const SizedBox(height: 80),
          Aviso(icono: Icons.cloud_off, texto: _error!, accion: _cargar),
        ],
      );
    }

    if (_tickets.isEmpty) {
      return ListView(
        children: [
          const SizedBox(height: 80),
          Aviso(
            icono: Icons.check_circle_outline,
            texto: _hayFiltros || _buscador.text.isNotEmpty
                ? 'No hay incidencias que coincidan con la búsqueda.'
                : 'No hay ninguna incidencia. Todo en orden.',
            accion: _hayFiltros ? _limpiarFiltros : null,
            etiquetaAccion: 'Quitar filtros',
          ),
        ],
      );
    }

    return ListView.separated(
      padding: EdgeInsets.fromLTRB(12, 12, 12, 90 + margenSistema(context)),
      itemCount: pendientes.length + (completados.isEmpty ? 0 : 1),
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, i) {
        if (i < pendientes.length) {
          return _FilaTicket(ticket: pendientes[i], alPulsar: () => _abrir(pendientes[i]));
        }
        return _completados(completados);
      },
    );
  }

  /// «Completados», plegado: se consulta de vez en cuando, no estorba arriba.
  Widget _completados(List<Ticket> completados) {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Tarjeta(
        recortar: true,
        child: ExpansionTile(
          initiallyExpanded: _completadosAbiertos,
          onExpansionChanged: (v) => _completadosAbiertos = v,
          shape: const Border(),
          collapsedShape: const Border(),
          leading: const Icon(Icons.check_circle_outline, color: Tema.gris),
          title: Text(
            'Completados (${completados.length})',
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Tema.gris),
          ),
          children: [
            for (final t in completados)
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                child: _FilaTicket(ticket: t, alPulsar: () => _abrir(t)),
              ),
          ],
        ),
      ),
    );
  }

  /// El menú lateral. Solo aparece lo que este usuario puede usar: son las
  /// mismas reglas que aplica el servidor, que las manda ya resueltas en
  /// `/api/meta`. Aun así el servidor las vuelve a comprobar en cada petición;
  /// esconder aquí es cortesía, no seguridad.
  Widget _menu(Sesion sesion, Usuario? usuario) {
    final meta = sesion.meta;
    final esAdmin = usuario?.esAdmin ?? false;

    void ir(Widget pantalla) {
      Navigator.pop(context);
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => pantalla))
          .then((_) {
        if (mounted) _cargar(silencioso: true);
      });
    }

    return Drawer(
      child: SafeArea(
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.warning_amber_rounded, size: 34, color: Tema.azul),
                  const SizedBox(height: 10),
                  Text(
                    usuario?.nombre ?? '',
                    style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
                  ),
                  Text(
                    _rolLegible(usuario),
                    style: const TextStyle(fontSize: 12.5, color: Tema.gris),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.list_alt),
              title: const Text('Incidencias'),
              selected: true,
              onTap: () => Navigator.pop(context),
            ),
            // El chat lo tiene todo el mundo: cada uno ve los canales de los
            // locales donde esta dado de alta. El numero es lo que hace que
            // uno se entere sin tener que entrar a mirar.
            ListenableBuilder(
              listenable: SesionScope.de(context).chat,
              builder: (_, __) {
                final sinLeer = SesionScope.de(context).chat.sinLeer;
                return ListTile(
                  leading: const Icon(Icons.forum_outlined),
                  title: const Text('Chat'),
                  trailing: sinLeer == 0
                      ? null
                      : Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(
                            color: Tema.azul,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            sinLeer > 99 ? '99+' : '$sinLeer',
                            style: const TextStyle(color: Colors.white, fontSize: 11),
                          ),
                        ),
                  onTap: () => ir(const PantallaChat()),
                );
              },
            ),
            if (meta?.puedeVerInformes ?? false)
              ListTile(
                leading: const Icon(Icons.insert_chart_outlined),
                title: const Text('Informes'),
                onTap: () => ir(const Informes()),
              ),
            if (meta?.puedeVerCalendario ?? false)
              ListTile(
                leading: const Icon(Icons.calendar_month_outlined),
                title: const Text('Calendario'),
                onTap: () => ir(const Calendario()),
              ),
            if (meta?.puedeProgramar ?? false)
              ListTile(
                leading: const Icon(Icons.schedule),
                title: const Text('Tareas programadas'),
                onTap: () => ir(const Tareas()),
              ),
            if (meta?.puedeUsarLavanderia ?? false)
              ListTile(
                leading: const Icon(Icons.local_laundry_service_outlined),
                title: const Text('Lavandería'),
                onTap: () => ir(const Lavanderia()),
              ),
            if (meta?.puedeUsarInventario ?? false)
              ListTile(
                leading: const Icon(Icons.inventory_2_outlined),
                title: const Text('Inventario'),
                onTap: () => ir(const Inventario()),
              ),
            if (esAdmin) ...[
              const Divider(height: 1),
              const Padding(
                padding: EdgeInsets.fromLTRB(20, 14, 20, 6),
                child: Text(
                  'ADMINISTRACIÓN',
                  style: TextStyle(
                    fontSize: 11,
                    letterSpacing: 1.1,
                    color: Tema.gris,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              ListTile(
                leading: const Icon(Icons.people_outline),
                title: const Text('Usuarios'),
                onTap: () => ir(const Usuarios()),
              ),
              ListTile(
                leading: const Icon(Icons.build_outlined),
                title: const Text('Departamentos'),
                onTap: () => ir(const Catalogos(tipo: TipoCatalogo.grupos)),
              ),
              ListTile(
                leading: const Icon(Icons.storefront_outlined),
                title: const Text('Locales'),
                onTap: () => ir(const Catalogos(tipo: TipoCatalogo.locales)),
              ),
              ListTile(
                leading: const Icon(Icons.category_outlined),
                title: const Text('Grupos y familias'),
                onTap: () => ir(const CatalogosFamilias()),
              ),
              ListTile(
                leading: const Icon(Icons.engineering_outlined),
                title: const Text('Empresas'),
                onTap: () => ir(const CatalogosEmpresas()),
              ),
              ListTile(
                leading: const Icon(Icons.local_laundry_service_outlined),
                title: const Text('Prendas'),
                onTap: () => ir(const Catalogos(tipo: TipoCatalogo.prendas)),
              ),
            ],
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.logout),
              title: const Text('Cerrar sesión'),
              onTap: () {
                Navigator.pop(context);
                sesion.salir();
              },
            ),
            // Al final y en pequeño, como en cualquier app: hay que poder
            // llegar a ella desde dentro, no solo desde la ficha de la tienda.
            ListTile(
              dense: true,
              leading: const Icon(Icons.privacy_tip_outlined, size: 20, color: Tema.gris),
              title: const Text(
                'Política de privacidad',
                style: TextStyle(fontSize: 13, color: Tema.gris),
              ),
              onTap: () {
                Navigator.pop(context);
                Privacidad.abrir(context);
              },
            ),
          ],
        ),
      ),
    );
  }

  String _rolLegible(Usuario? u) {
    switch (u?.rol) {
      case 'admin':
        return 'Administrador';
      case 'gestor':
        return 'Gestor';
      case 'tecnico':
        return 'Técnico${u?.grupoNombre != null ? ' · ${u!.grupoNombre}' : ''}';
      default:
        return 'Empleado';
    }
  }

  Future<void> _abrirFiltros() async {
    final meta = SesionScope.de(context).meta;
    if (meta == null) return;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _HojaFiltros(
        meta: meta,
        grupoId: _grupoId,
        localId: _localId,
        areaId: _areaId,
        familiaId: _familiaId,
        subfamiliaId: _subfamiliaId,
        estado: _estado,
        prioridad: _prioridad,
        asignado: _asignado,
        esTecnico: SesionScope.de(context).usuario?.esTecnico ?? false,
        alAplicar: ({grupoId, localId, areaId, familiaId, subfamiliaId, estado, prioridad, asignado}) {
          setState(() {
            _grupoId = grupoId;
            _localId = localId;
            _areaId = areaId;
            _familiaId = familiaId;
            _subfamiliaId = subfamiliaId;
            _estado = estado;
            _prioridad = prioridad;
            _asignado = asignado;
          });
          _cargar();
        },
      ),
    );
  }
}

/// Una incidencia en la lista: lo justo para decidir si hay que abrirla.
class _FilaTicket extends StatelessWidget {
  const _FilaTicket({required this.ticket, required this.alPulsar});

  final Ticket ticket;
  final VoidCallback alPulsar;

  @override
  Widget build(BuildContext context) {
    final esGestion = SesionScope.de(context).usuario?.gestiona ?? false;
    return Tarjeta(
      child: InkWell(
        onTap: alPulsar,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '#${ticket.id}',
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 12,
                      color: Tema.gris,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      ticket.titulo,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: ticket.cerrado ? Tema.gris : null,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  DistintivoEstado(ticket.estado),
                  DistintivoPrioridad(ticket.prioridad, cerrado: ticket.cerrado),
                  DistintivoRespuesta(ticket.respuesta, esGestion: esGestion),
                  _Dato(Icons.storefront_outlined, ticket.localNombre),
                  _Dato(Icons.build_outlined, ticket.grupoNombre),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      ticket.asignadoNombre == null
                          ? 'Sin asignar'
                          : 'Asignada a ${ticket.asignadoNombre}',
                      style: TextStyle(
                        fontSize: 12,
                        color: ticket.asignadoNombre == null ? Tema.ambar : Tema.gris,
                        fontWeight: ticket.asignadoNombre == null
                            ? FontWeight.w600
                            : FontWeight.normal,
                      ),
                    ),
                  ),
                  if (ticket.mensajes > 0) ...[
                    const Icon(Icons.forum_outlined, size: 14, color: Tema.gris),
                    const SizedBox(width: 3),
                    Text('${ticket.mensajes}',
                        style: const TextStyle(fontSize: 12, color: Tema.gris)),
                    const SizedBox(width: 8),
                  ],
                  if (ticket.adjuntos > 0) ...[
                    const Icon(Icons.attach_file, size: 14, color: Tema.gris),
                    const SizedBox(width: 3),
                    Text('${ticket.adjuntos}',
                        style: const TextStyle(fontSize: 12, color: Tema.gris)),
                    const SizedBox(width: 8),
                  ],
                  Text(
                    cuando(ticket.actualizadoEn),
                    style: const TextStyle(fontSize: 12, color: Tema.gris),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Dato extends StatelessWidget {
  const _Dato(this.icono, this.texto);

  final IconData icono;
  final String texto;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icono, size: 13, color: Tema.gris),
        const SizedBox(width: 3),
        Text(texto, style: const TextStyle(fontSize: 12, color: Tema.gris)),
      ],
    );
  }
}

/// Los filtros de la lista, en una hoja que sube desde abajo.
class _HojaFiltros extends StatefulWidget {
  const _HojaFiltros({
    required this.meta,
    required this.grupoId,
    required this.localId,
    required this.areaId,
    required this.familiaId,
    required this.subfamiliaId,
    required this.estado,
    required this.prioridad,
    required this.asignado,
    required this.esTecnico,
    required this.alAplicar,
  });

  final Meta meta;
  final int? grupoId;
  final int? localId;
  final int? areaId;
  final int? familiaId;
  final int? subfamiliaId;
  final String? estado;
  final String? prioridad;
  final String? asignado;
  final bool esTecnico;

  // Con nombre, no posicionales: son ya ocho campos del mismo tipo (int? o
  // String?) y confundir el orden de dos adyacentes sería un error silencioso.
  final void Function({
    int? grupoId,
    int? localId,
    int? areaId,
    int? familiaId,
    int? subfamiliaId,
    String? estado,
    String? prioridad,
    String? asignado,
  }) alAplicar;

  @override
  State<_HojaFiltros> createState() => _HojaFiltrosState();
}

class _HojaFiltrosState extends State<_HojaFiltros> {
  late int? _grupoId = widget.grupoId;
  late int? _localId = widget.localId;
  late int? _areaId = widget.areaId;
  late int? _familiaId = widget.familiaId;
  late int? _subfamiliaId = widget.subfamiliaId;
  late String? _estado = widget.estado;
  late String? _prioridad = widget.prioridad;
  late String? _asignado = widget.asignado;

  @override
  Widget build(BuildContext context) {
    return Padding(
      // Abajo hay que dejar sitio a dos cosas distintas: el teclado
      // (`viewInsets`) y la barra de botones del sistema (`viewPadding`). Sin
      // la segunda, «Limpiar» y «Aplicar» quedan debajo de los botones del
      // móvil y no se pueden pulsar.
      padding: EdgeInsets.fromLTRB(
        16,
        0,
        16,
        MediaQuery.of(context).viewInsets.bottom +
            MediaQuery.of(context).viewPadding.bottom +
            24,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Filtros',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
            const SizedBox(height: 16),
            _desplegable<int>(
              'Departamento',
              _grupoId,
              [for (final g in widget.meta.grupos) DropdownMenuItem(value: g.id, child: Text(g.nombre))],
              (v) => setState(() => _grupoId = v),
            ),
            const SizedBox(height: 12),
            _desplegable<int>(
              'Local',
              _localId,
              [for (final l in widget.meta.locales) DropdownMenuItem(value: l.id, child: Text(l.nombre))],
              (v) => setState(() => _localId = v),
            ),
            const SizedBox(height: 12),
            _desplegable<int>(
              'Grupo',
              _areaId,
              [for (final a in widget.meta.areas) DropdownMenuItem(value: a.id, child: Text(a.nombre))],
              // La familia y la subfamilia elegidas eran del grupo anterior:
              // se limpian con él.
              (v) => setState(() {
                _areaId = v;
                _familiaId = null;
                _subfamiliaId = null;
              }),
            ),
            const SizedBox(height: 12),
            _desplegable<int>(
              'Familia',
              _familiaId,
              [
                for (final f in widget.meta.familias.where((f) => _areaId == null || f.areaId == _areaId))
                  DropdownMenuItem(value: f.id, child: Text(f.nombre)),
              ],
              // La subfamilia elegida era de la familia anterior: se limpia con ella.
              (v) => setState(() {
                _familiaId = v;
                _subfamiliaId = null;
              }),
            ),
            const SizedBox(height: 12),
            _desplegable<int>(
              'Subfamilia',
              _subfamiliaId,
              [
                for (final s in widget.meta.subfamilias.where((s) => s.familiaId == _familiaId))
                  DropdownMenuItem(value: s.id, child: Text(s.nombre)),
              ],
              (v) => setState(() => _subfamiliaId = v),
            ),
            const SizedBox(height: 12),
            _desplegable<String>(
              'Estado',
              _estado,
              [
                for (final e in etiquetasEstado.entries)
                  DropdownMenuItem(value: e.key, child: Text(e.value)),
              ],
              (v) => setState(() => _estado = v),
            ),
            const SizedBox(height: 12),
            _desplegable<String>(
              'Prioridad',
              _prioridad,
              [
                for (final p in etiquetasPrioridad.entries)
                  DropdownMenuItem(value: p.key, child: Text(p.value)),
              ],
              (v) => setState(() => _prioridad = v),
            ),
            const SizedBox(height: 12),
            _desplegable<String>(
              'Asignación',
              _asignado,
              [
                // «Mías» solo tiene sentido para quien puede tener incidencias
                // asignadas.
                if (widget.esTecnico)
                  const DropdownMenuItem(value: 'mias', child: Text('Mías')),
                const DropdownMenuItem(value: 'sin_asignar', child: Text('Sin asignar')),
              ],
              (v) => setState(() => _asignado = v),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () {
                      widget.alAplicar();
                      Navigator.pop(context);
                    },
                    child: const Text('Limpiar'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    onPressed: () {
                      widget.alAplicar(
                        grupoId: _grupoId,
                        localId: _localId,
                        areaId: _areaId,
                        familiaId: _familiaId,
                        subfamiliaId: _subfamiliaId,
                        estado: _estado,
                        prioridad: _prioridad,
                        asignado: _asignado,
                      );
                      Navigator.pop(context);
                    },
                    child: const Text('Aplicar'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// Desplegable con «Todos» como primera opción, que es quitar el filtro.
  Widget _desplegable<T>(
    String etiqueta,
    T? valor,
    List<DropdownMenuItem<T>> opciones,
    void Function(T?) alCambiar,
  ) {
    return DropdownButtonFormField<T>(
      value: valor,
      isExpanded: true,
      decoration: InputDecoration(labelText: etiqueta, isDense: true),
      items: [
        DropdownMenuItem<T>(value: null, child: const Text('Todos')),
        ...opciones,
      ],
      onChanged: alCambiar,
    );
  }
}
