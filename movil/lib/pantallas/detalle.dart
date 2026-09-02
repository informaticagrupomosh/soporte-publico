import 'dart:async';

import 'package:flutter/material.dart';

import '../app.dart';
import '../modelos/modelos.dart';
import '../nucleo/api.dart';
import '../nucleo/formato.dart';
import '../nucleo/tema.dart';
import '../widgets/etiquetas.dart';
import '../widgets/adjuntos.dart';
import '../widgets/banner_conexion.dart';
import '../widgets/tarjeta.dart';

/// La ficha de la incidencia: los datos, el hilo y los adjuntos.
///
/// Recibe el identificador y no el objeto porque también se entra desde una
/// notificación, donde lo único que llega es `ticket_id`.
class DetalleTicket extends StatefulWidget {
  const DetalleTicket({super.key, required this.ticketId});

  final int ticketId;

  @override
  State<DetalleTicket> createState() => _DetalleTicketState();
}

class _DetalleTicketState extends State<DetalleTicket> with WidgetsBindingObserver {
  final _mensaje = TextEditingController();
  final _desplazamiento = ScrollController();
  final _foco = FocusNode();

  /// Archivos ya subidos que se mandarán con el próximo mensaje. Van dentro de
  /// él, no sueltos en la incidencia.
  final List<Borrador> _borradores = [];

  Ticket? _ticket;
  bool _cargando = true;
  bool _enviando = false;
  String? _error;
  Timer? _reloj;

  // Cambios de gestión aún sin guardar. Como en la web, se eligen varios y se
  // guardan de una vez con el botón; elegir no guarda.
  String? _estado;
  String? _prioridad;
  int? _asignado;
  bool _hayCambios = false;

  bool _iniciado = false;

  @override
  void initState() {
    super.initState();
    // Al abrir el teclado el hilo sube al final: si no, se escribiría sin ver
    // lo último que ha dicho el otro.
    _foco.addListener(() {
      if (_foco.hasFocus) _alFinal();
    });
  }

  /// Igual que en la lista: la sesión no se puede leer desde `initState`.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_iniciado) return;
    _iniciado = true;
    WidgetsBinding.instance.addObserver(this);
    _cargar();
    // El hilo es una conversación: conviene que se refresque solo.
    _reloj = Timer.periodic(const Duration(seconds: 20), (_) => _cargar(silencioso: true));
  }

  // Al volver del segundo plano no hace falta esperar al siguiente tic: si el
  // otro lado ha contestado mientras tanto, se ve nada más abrir la app.
  @override
  void didChangeAppLifecycleState(AppLifecycleState estado) {
    if (estado == AppLifecycleState.resumed) _cargar(silencioso: true);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _reloj?.cancel();
    _mensaje.dispose();
    _desplazamiento.dispose();
    _foco.dispose();
    super.dispose();
  }

  Future<void> _cargar({bool silencioso = false}) async {
    // Mientras haya cambios sin guardar, el refresco automático no puede pisar
    // lo que el técnico acaba de elegir.
    if (silencioso && _hayCambios) return;

    if (!silencioso) setState(() => _cargando = true);
    try {
      final datos = await SesionScope.de(context).api.get('/api/tickets/${widget.ticketId}');
      if (!mounted) return;
      final ticket = Ticket.desdeJson(datos as Map<String, dynamic>);
      setState(() {
        _ticket = ticket;
        _estado = ticket.estado;
        _prioridad = ticket.prioridad;
        _asignado = ticket.asignadoA;
        _hayCambios = false;
        _cargando = false;
        _error = null;
      });
    } on ErrorApi catch (e) {
      if (!mounted) return;
      setState(() {
        _cargando = false;
        if (!silencioso || _ticket == null) _error = e.mensaje;
      });
    }
  }

  Future<void> _guardarGestion() async {
    final ticket = _ticket;
    if (ticket == null) return;

    setState(() => _enviando = true);
    try {
      // Encolable: sin conexión se anota y sale sola. Cambiar el estado de una
      // avería no puede depender de la cobertura del almacén.
      final datos = await SesionScope.de(context).api.put(
        '/api/tickets/${ticket.id}',
        {
          'estado': _estado,
          'prioridad': _prioridad,
          // La clave tiene que ir aunque sea nula: así el servidor distingue
          // «déjalo sin asignar» de «no lo toques».
          'asignado_a': _asignado,
        },
        true,
        'Cambios en la incidencia #${ticket.id}',
      );
      if (!mounted) return;
      if (datos is Map && datos[Api.claveEncolado] == true) {
        setState(() => _hayCambios = false);
        avisarEncolado(context, 'El cambio');
        return;
      }
      setState(() {
        _ticket = Ticket.desdeJson(datos as Map<String, dynamic>);
        _hayCambios = false;
      });
      _avisar('Incidencia actualizada.');
      // El PUT no devuelve el hilo ni los adjuntos: hay que recargarlos.
      await _cargar(silencioso: true);
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  Future<void> _enviarMensaje() async {
    final texto = _mensaje.text.trim();
    // Un mensaje puede ser solo una foto, sin texto.
    if ((texto.isEmpty && _borradores.isEmpty) || _ticket == null) return;

    setState(() => _enviando = true);
    try {
      // Encolable, como el cambio de estado: lo que se escribe en un hilo sin
      // cobertura sale solo al volver la línea. Los adjuntos, en cambio, ya
      // están subidos —se suben antes que el mensaje—, así que si están aquí
      // es que había red al elegirlos.
      final datos = await SesionScope.de(context).api.post(
        '/api/tickets/${_ticket!.id}/mensajes',
        {
          'contenido': texto,
          'adjuntos': _borradores.map((b) => b.id).toList(),
        },
        true,
        'Respuesta en la incidencia #${_ticket!.id}',
      );
      _mensaje.clear();
      _borradores.clear();
      if (mounted && datos is Map && datos[Api.claveEncolado] == true) {
        avisarEncolado(context, 'Tu respuesta');
        return;
      }
      await _cargar(silencioso: true);
      _alFinal();
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  void _alFinal() {
    Future.delayed(const Duration(milliseconds: 120), () {
      if (!mounted) return;
      if (_desplazamiento.hasClients) {
        _desplazamiento.animateTo(
          _desplazamiento.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _borrarTicket() async {
    final seguro = await showDialog<bool>(
      context: context,
      builder: (dialogo) => AlertDialog(
        title: const Text('Eliminar la incidencia'),
        content: const Text(
          'Se borran también su hilo y sus adjuntos. No se puede deshacer.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogo, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Tema.rojo),
            onPressed: () => Navigator.pop(dialogo, true),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
    if (seguro != true || !mounted) return;

    try {
      await SesionScope.de(context).api.delete('/api/tickets/${widget.ticketId}');
      if (mounted) Navigator.pop(context);
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    }
  }

  void _avisar(String texto, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(texto),
      backgroundColor: error ? Tema.rojo : null,
    ));
  }

  @override
  Widget build(BuildContext context) {
    final ticket = _ticket;

    return Scaffold(
      appBar: AppBar(
        title: Text('Incidencia #${widget.ticketId}'),
        actions: [
          if (ticket != null)
            IconButton(
              tooltip: 'Actualizar',
              onPressed: _cargar,
              icon: const Icon(Icons.refresh),
            ),
          // Borrar una incidencia es cosa del administrador, y solo suya.
          if (ticket != null && (SesionScope.de(context).usuario?.esAdmin ?? false))
            IconButton(
              tooltip: 'Eliminar incidencia',
              onPressed: _borrarTicket,
              icon: const Icon(Icons.delete_outline),
            ),
        ],
      ),
      // La caja de escribir va dentro del cuerpo, no en `bottomNavigationBar`:
      // esa barra no la levanta el teclado y la caja quedaba debajo, que es
      // justo donde no sirve.
      body: Column(
        children: [
          Expanded(child: _cuerpo(ticket)),
          if (ticket != null) _redactor(),
        ],
      ),
    );
  }

  Widget _cuerpo(Ticket? ticket) {
    if (_cargando && ticket == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (ticket == null) {
      return Aviso(
        icono: Icons.search_off,
        // El servidor responde 404 tanto si no existe como si no le toca a este
        // usuario, a propósito: así no se puede sondear probando números.
        texto: _error ?? 'Esta incidencia no existe o no tienes acceso a ella.',
        accion: _cargar,
      );
    }

    final usuario = SesionScope.de(context).usuario;

    return RefreshIndicator(
      onRefresh: _cargar,
      child: ListView(
        controller: _desplazamiento,
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 16),
        children: [
          _cabecera(ticket, usuario),
          if (ticket.puedeGestionar) ...[
            const SizedBox(height: 12),
            _gestion(ticket),
          ],
          if (_adjuntosDeLaFicha(ticket).isNotEmpty) ...[
            const SizedBox(height: 12),
            _bloqueAdjuntos(ticket),
          ],
          const SizedBox(height: 16),
          _hilo(ticket, usuario),
        ],
      ),
    );
  }

  /// Si la incidencia lleva su descripción como primer mensaje del hilo.
  bool _tieneApertura(Ticket t) => t.hilo.any((m) => m.apertura);

  /// Los adjuntos que cuelgan de la incidencia, no de un mensaje del hilo.
  List<Adjunto> _adjuntosDeLaFicha(Ticket t) =>
      t.listaAdjuntos.where((a) => a.mensajeId == null).toList();

  Widget _cabecera(Ticket ticket, Usuario? usuario) {
    return Tarjeta(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              ticket.titulo,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                DistintivoEstado(ticket.estado),
                DistintivoPrioridad(ticket.prioridad, cerrado: ticket.cerrado),
                DistintivoRespuesta(ticket.respuesta, esGestion: usuario?.gestiona ?? false),
              ],
            ),
            // La descripción solo se repite aquí en las incidencias antiguas.
            // En las nuevas es el primer mensaje del hilo, y leerla dos veces en
            // la misma pantalla sobra.
            if (!_tieneApertura(ticket) &&
                (ticket.descripcion ?? '').trim().isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(ticket.descripcion!, style: const TextStyle(fontSize: 14.5, height: 1.4)),
            ],
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Divider(),
            ),
            _linea(Icons.storefront_outlined, 'Local', ticket.localNombre),
            _linea(Icons.build_outlined, 'Departamento', ticket.grupoNombre),
            if (ticket.areaNombre != null)
              _linea(Icons.widgets_outlined, 'Grupo', ticket.areaNombre!),
            if (ticket.familiaNombre != null)
              _linea(Icons.category_outlined, 'Familia', ticket.familiaNombre!),
            if (ticket.subfamiliaNombre != null)
              _linea(Icons.label_outline, 'Subfamilia', ticket.subfamiliaNombre!),
            if (ticket.empresaNombre != null)
              _linea(Icons.engineering_outlined, 'Empresa', ticket.empresaNombre!),
            if (ticket.activoNombre != null)
              _linea(Icons.inventory_2_outlined, 'Activo', ticket.activoNombre!),
            _linea(Icons.person_outline, 'Abierta por', ticket.abiertaPor),
            _linea(
              Icons.engineering_outlined,
              'Asignada a',
              ticket.asignadoNombre ?? 'Sin asignar',
            ),
            _linea(Icons.schedule, 'Abierta', fechaHora(ticket.creadoEn)),
          ],
        ),
      ),
    );
  }

  Widget _linea(IconData icono, String etiqueta, String valor) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icono, size: 16, color: Tema.gris),
          const SizedBox(width: 8),
          SizedBox(
            width: 96,
            child: Text(etiqueta,
                style: const TextStyle(fontSize: 13, color: Tema.gris)),
          ),
          Expanded(child: Text(valor, style: const TextStyle(fontSize: 13.5))),
        ],
      ),
    );
  }

  /// Estado, prioridad y asignación. Se guardan al pulsar «Guardar», no al
  /// elegirlos, para poder cambiar varias cosas de una vez.
  Widget _gestion(Ticket ticket) {
    final meta = SesionScope.de(context).meta;
    // Una incidencia solo se asigna a un técnico de su mismo grupo.
    final tecnicos =
        (meta?.tecnicos ?? []).where((t) => t.grupoId == ticket.grupoId).toList();

    return Tarjeta(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Gestión',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              value: _estado,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Estado', isDense: true),
              items: [
                for (final e in etiquetasEstado.entries)
                  DropdownMenuItem(value: e.key, child: Text(e.value)),
              ],
              onChanged: (v) => setState(() {
                _estado = v;
                _hayCambios = true;
              }),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              value: _prioridad,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Prioridad', isDense: true),
              items: [
                for (final p in etiquetasPrioridad.entries)
                  DropdownMenuItem(value: p.key, child: Text(p.value)),
              ],
              onChanged: (v) => setState(() {
                _prioridad = v;
                _hayCambios = true;
              }),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<int>(
              value: tecnicos.any((t) => t.id == _asignado) ? _asignado : null,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Asignada a', isDense: true),
              items: [
                const DropdownMenuItem(value: null, child: Text('Sin asignar')),
                for (final t in tecnicos)
                  DropdownMenuItem(value: t.id, child: Text(t.nombre)),
              ],
              onChanged: (v) => setState(() {
                _asignado = v;
                _hayCambios = true;
              }),
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: (_hayCambios && !_enviando) ? _guardarGestion : null,
              icon: const Icon(Icons.save_outlined, size: 18),
              label: Text(_hayCambios ? 'Guardar' : 'Sin cambios'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _bloqueAdjuntos(Ticket ticket) {
    return Tarjeta(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Adjuntos',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            const SizedBox(height: 10),
            RejillaAdjuntos(
              adjuntos: _adjuntosDeLaFicha(ticket),
              alBorrar: () => _cargar(silencioso: true),
            ),
          ],
        ),
      ),
    );
  }

  /// El hilo enfrenta los dos lados, como la web: lo propio a la derecha y lo
  /// del otro a la izquierda.
  Widget _hilo(Ticket ticket, Usuario? usuario) {
    if (ticket.hilo.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Text(
          'Todavía no hay mensajes en esta incidencia.',
          textAlign: TextAlign.center,
          style: TextStyle(color: Tema.gris, fontSize: 13.5),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(left: 4, bottom: 8),
          child: Text('Conversación',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
        ),
        for (final m in ticket.hilo)
          _Burbuja(
            mensaje: m,
            propio: m.autorId == usuario?.id,
            adjuntos:
                ticket.listaAdjuntos.where((a) => a.mensajeId == m.id).toList(),
            alBorrarAdjunto: () => _cargar(silencioso: true),
          ),
      ],
    );
  }

  /// La caja de escribir, anclada abajo. En una incidencia cerrada no aparece:
  /// primero hay que reabrirla.
  Widget _redactor() {
    final ticket = _ticket!;

    if (ticket.cerrado) {
      return SafeArea(
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: const BoxDecoration(
            color: Colors.white,
            border: Border(top: BorderSide(color: Tema.borde)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.lock_outline, size: 16, color: Tema.gris),
              const SizedBox(width: 8),
              Text(
                ticket.puedeGestionar
                    ? 'Incidencia cerrada. Reábrela para escribir.'
                    : 'Incidencia cerrada.',
                style: const TextStyle(color: Tema.gris, fontSize: 13),
              ),
            ],
          ),
        ),
      );
    }

    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: Tema.borde)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Lo que ya está subido y va a ir con este mensaje.
            TiraBorradores(
              borradores: _borradores,
              alQuitar: (b) {
                setState(() => _borradores.remove(b));
                SesionScope.de(context).api.descartarBorrador(b.id);
              },
            ),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                BotonAdjuntar(
                  alSubir: (b) => setState(() => _borradores.add(b)),
                ),
                Expanded(
                  child: TextField(
                    controller: _mensaje,
                    focusNode: _foco,
                    minLines: 1,
                    maxLines: 4,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(
                      hintText: 'Escribe un mensaje…',
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                IconButton.filled(
                  onPressed: _enviando ? null : _enviarMensaje,
                  icon: _enviando
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.send, size: 18),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Burbuja extends StatelessWidget {
  const _Burbuja({
    required this.mensaje,
    required this.propio,
    required this.adjuntos,
    this.alBorrarAdjunto,
  });

  final Mensaje mensaje;
  final bool propio;
  final List<Adjunto> adjuntos;
  final VoidCallback? alBorrarAdjunto;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: propio ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.82,
        ),
        child: Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          decoration: BoxDecoration(
            color: propio ? Tema.azul.withOpacity(0.09) : Colors.white,
            border: Border.all(color: propio ? Tema.azul.withOpacity(0.25) : Tema.borde),
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(12),
              topRight: const Radius.circular(12),
              bottomLeft: Radius.circular(propio ? 12 : 2),
              bottomRight: Radius.circular(propio ? 2 : 12),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (!propio)
                Text(
                  mensaje.autorNombre,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: Tema.azul,
                  ),
                ),
              if (!propio) const SizedBox(height: 3),
              Text(mensaje.contenido, style: const TextStyle(fontSize: 14.5, height: 1.35)),
              if (adjuntos.isNotEmpty) ...[
                const SizedBox(height: 8),
                RejillaAdjuntos(adjuntos: adjuntos, alBorrar: alBorrarAdjunto),
              ],
              const SizedBox(height: 4),
              Align(
                alignment: Alignment.centerRight,
                child: Text(
                  horaCorta(mensaje.creadoEn),
                  style: const TextStyle(fontSize: 10.5, color: Tema.gris),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
