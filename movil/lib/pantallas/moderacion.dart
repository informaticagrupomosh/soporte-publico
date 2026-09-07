import 'package:flutter/material.dart';

import '../app.dart';
import '../modelos/chat.dart';
import '../nucleo/api.dart';
import '../nucleo/formato.dart';
import '../nucleo/tema.dart';
import '../widgets/etiquetas.dart';
import '../widgets/tarjeta.dart';

/// La cola de mensajes denunciados. Solo para administradores.
///
/// Existe también aquí, y no solo en la web, porque el plazo con el que se
/// atiende un aviso es de horas y quien lo atiende no está sentado delante de
/// un ordenador: lleva el teléfono encima, y es en el teléfono donde le llega
/// el push que dice que hay algo que mirar.
///
/// Se puede hacer lo mismo que desde la web: borrar el mensaje, suspender a
/// quien lo escribió o dar el aviso por atendido sin tocar nada, que también es
/// una decisión.
class Moderacion extends StatefulWidget {
  const Moderacion({super.key});

  @override
  State<Moderacion> createState() => _ModeracionState();
}

class _ModeracionState extends State<Moderacion> {
  List<DenunciaChat> _denuncias = [];
  bool _resueltas = false;
  bool _cargando = true;
  String? _error;
  bool _iniciado = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_iniciado) return;
    _iniciado = true;
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() => _cargando = true);
    try {
      final datos = await SesionScope.de(context).api.get(
            '/api/chat/denuncias',
            _resueltas ? {'resueltas': '1'} : null,
          ) as List;
      if (!mounted) return;
      setState(() {
        _denuncias = [
          for (final d in datos) DenunciaChat.desdeJson(d as Map<String, dynamic>),
        ];
        _error = null;
        _cargando = false;
      });
      // El número del menú, al día sin esperar a la siguiente sincronización:
      // acabas de atender algo y verlo seguir ahí desconcierta. Solo cuando lo
      // que se está mirando son las pendientes, que son las que cuenta.
      if (!_resueltas) {
        SesionScope.de(context).chat.anotarPendientes(_denuncias.length);
      }
    } on ErrorApi catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.mensaje;
        _cargando = false;
      });
    }
  }

  void _cambiarPestana(bool resueltas) {
    if (_resueltas == resueltas) return;
    setState(() {
      _resueltas = resueltas;
      _denuncias = [];
    });
    _cargar();
  }

  // ---------- Lo que se puede hacer ----------

  Future<void> _borrarMensaje(DenunciaChat d) async {
    if (!await _confirmar(
      titulo: 'Eliminar el mensaje',
      texto: 'Deja de verse para todos. El aviso queda como atendido y se le '
          'dice a ${d.denunciante}.',
      aceptar: 'Eliminar',
    )) return;
    await _hacer(() => SesionScope.de(context).api.delete(
          '/api/chat/mensajes/${d.mensajeId}',
        ));
  }

  Future<void> _suspender(DenunciaChat d) async {
    if (!await _confirmar(
      titulo: 'Suspender a ${d.autorNombre}',
      texto: 'Dejará de poder entrar y se cerrarán sus sesiones. Sus '
          'incidencias y sus mensajes anteriores se quedan como están.',
      aceptar: 'Suspender',
    )) return;
    await _hacer(() => SesionScope.de(context).api.post(
          '/api/usuarios/${d.autorId}/suspender',
        ));
  }

  Future<void> _resolver(DenunciaChat d) async {
    await _hacer(() => SesionScope.de(context).api.post(
          '/api/chat/denuncias/${d.id}/resolver',
        ));
  }

  Future<bool> _confirmar({
    required String titulo,
    required String texto,
    required String aceptar,
  }) async {
    final seguro = await showDialog<bool>(
      context: context,
      builder: (dialogo) => AlertDialog(
        title: Text(titulo),
        content: Text(texto),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogo, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Tema.rojo),
            onPressed: () => Navigator.pop(dialogo, true),
            child: Text(aceptar),
          ),
        ],
      ),
    );
    return seguro == true && mounted;
  }

  /// Cualquiera de las tres acciones acaba igual: recargar la cola.
  ///
  /// No se toca la lista a mano porque una acción cambia más de una fila —
  /// borrar un mensaje cierra todas sus denuncias, suspender a alguien marca a
  /// todas las suyas— y adivinar cuáles desde aquí sería inventarse el estado
  /// del servidor.
  Future<void> _hacer(Future<dynamic> Function() accion) async {
    try {
      await accion();
      if (!mounted) return;
      await _cargar();
    } on ErrorApi catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.mensaje),
        backgroundColor: Tema.rojo,
      ));
    }
  }

  // ---------- Pintado ----------

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Moderación'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
            child: SegmentedButton<bool>(
              segments: const [
                ButtonSegment(value: false, label: Text('Pendientes')),
                ButtonSegment(value: true, label: Text('Resueltas')),
              ],
              selected: {_resueltas},
              onSelectionChanged: (s) => _cambiarPestana(s.first),
            ),
          ),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: _cargar,
        child: _cargando && _denuncias.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : _error != null && _denuncias.isEmpty
                ? ListView(children: [
                    const SizedBox(height: 80),
                    Aviso(icono: Icons.cloud_off, texto: _error!, accion: _cargar),
                  ])
                : _denuncias.isEmpty
                    ? ListView(children: [
                        const SizedBox(height: 80),
                        Aviso(
                          icono: _resueltas ? Icons.history : Icons.check_circle_outline,
                          texto: _resueltas
                              ? 'Todavía no se ha resuelto ninguna.'
                              : 'No hay nada pendiente.',
                        ),
                      ])
                    : ListView.separated(
                        padding: EdgeInsets.fromLTRB(12, 12, 12, 20 + margenSistema(context)),
                        itemCount: _denuncias.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (_, i) => _ficha(_denuncias[i]),
                      ),
      ),
    );
  }

  Widget _ficha(DenunciaChat d) {
    return Tarjeta(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 6,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Distintivo(texto: d.canal, color: Tema.gris),
                if (d.borrado)
                  const Distintivo(texto: 'Mensaje eliminado', color: Tema.gris),
                if (d.autorSuspendida)
                  const Distintivo(texto: 'Autor suspendido', color: Tema.rojo, suave: false),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              '${d.denunciante} avisó ${cuando(d.creadoEn)}',
              style: const TextStyle(fontSize: 12.5, color: Tema.gris),
            ),
            if (d.motivo.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text('«${d.motivo}»', style: const TextStyle(fontSize: 14)),
            ],
            const SizedBox(height: 10),
            _mensaje(d),
            if (d.resueltoEn != null) ...[
              const SizedBox(height: 8),
              Text(
                'Resuelta ${cuando(d.resueltoEn)}'
                '${d.resueltoPor != null ? ' por ${d.resueltoPor}' : ''}',
                style: const TextStyle(fontSize: 12, color: Tema.gris),
              ),
            ] else
              _acciones(d),
          ],
        ),
      ),
    );
  }

  /// El mensaje señalado, con una raya a la izquierda: es una cita, no algo
  /// que haya escrito la aplicación.
  Widget _mensaje(DenunciaChat d) {
    return Container(
      padding: const EdgeInsets.only(left: 10),
      decoration: const BoxDecoration(
        border: Border(left: BorderSide(color: Tema.borde, width: 3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${d.autorNombre} · ${fechaHora(d.mensajeEn)}',
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 2),
          Text(
            d.borrado
                ? 'Eliminado'
                : (d.contenido.isEmpty ? 'Sin texto' : d.contenido),
            style: TextStyle(
              fontSize: 14,
              color: d.borrado || d.contenido.isEmpty ? Tema.gris : null,
              fontStyle: d.borrado || d.contenido.isEmpty
                  ? FontStyle.italic
                  : FontStyle.normal,
            ),
          ),
          // Los adjuntos se nombran, no se pintan: hay que poder recorrer la
          // cola sin que se abra en pantalla lo que justamente han denunciado.
          if (d.adjuntos.isNotEmpty) ...[
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                for (final a in d.adjuntos)
                  Distintivo(texto: a.nombre, color: Tema.gris),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _acciones(DenunciaChat d) {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Wrap(
        alignment: WrapAlignment.end,
        spacing: 4,
        children: [
          if (!d.borrado)
            TextButton.icon(
              onPressed: () => _borrarMensaje(d),
              icon: const Icon(Icons.delete_outline, size: 18, color: Tema.rojo),
              label: const Text('Eliminar', style: TextStyle(color: Tema.rojo)),
            ),
          if (!d.autorSuspendida)
            TextButton.icon(
              onPressed: () => _suspender(d),
              icon: const Icon(Icons.block, size: 18, color: Tema.rojo),
              label: const Text('Suspender', style: TextStyle(color: Tema.rojo)),
            ),
          TextButton(
            onPressed: () => _resolver(d),
            child: const Text('Resuelta'),
          ),
        ],
      ),
    );
  }
}
