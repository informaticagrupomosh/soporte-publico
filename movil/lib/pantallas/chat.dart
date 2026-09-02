import 'package:flutter/material.dart';

import '../app.dart';
import '../modelos/chat.dart';
import '../nucleo/formato.dart';
import '../nucleo/tema.dart';
import '../servicios/chat.dart';
import 'chat_canal.dart';

/// Los canales: uno por cada local en el que se está dado de alta.
///
/// Se pinta con lo que hay guardado en el teléfono, así que aparece llena antes
/// de que la red conteste. Lo que llegue del servidor la completa.
class PantallaChat extends StatefulWidget {
  const PantallaChat({super.key});

  @override
  State<PantallaChat> createState() => _PantallaChatState();
}

class _PantallaChatState extends State<PantallaChat> {
  ServicioChat? _chat;
  bool _iniciado = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_iniciado) return;
    _iniciado = true;
    _chat = SesionScope.de(context).chat;
    _chat!.addListener(_alCambiar);
    // Al entrar en la pantalla se pregunta por lo que falte: es barato —una
    // petición— y es lo que hace que la lista esté al día nada más abrirla.
    _chat!.sincronizar();
  }

  void _alCambiar() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _chat?.removeListener(_alCambiar);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final chat = _chat!;
    final canales = chat.canales;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Chat'),
        actions: [
          // El punto de la conexión: sin él, «no llega nada» y «no ha escrito
          // nadie» se ven igual.
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Center(
              child: Tooltip(
                message: chat.conectado ? 'Conectado' : 'Sin conexión',
                child: Container(
                  width: 9,
                  height: 9,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: chat.conectado ? Tema.verde : Tema.borde,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: chat.sincronizar,
        child: canales.isEmpty
            ? ListView(
                children: const [
                  SizedBox(height: 80),
                  Center(
                    child: Padding(
                      padding: EdgeInsets.symmetric(horizontal: 32),
                      child: Text(
                        'No estás dado de alta en ningún local, así que todavía '
                        'no tienes ningún canal.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Tema.gris),
                      ),
                    ),
                  ),
                ],
              )
            : ListView.separated(
                itemCount: canales.length,
                separatorBuilder: (_, __) => const Divider(height: 1, indent: 16),
                itemBuilder: (_, i) => _FilaCanal(canal: canales[i]),
              ),
      ),
    );
  }
}

class _FilaCanal extends StatelessWidget {
  const _FilaCanal({required this.canal});

  final CanalChat canal;

  @override
  Widget build(BuildContext context) {
    final yo = SesionScope.de(context).usuario?.id;
    final ultimo = canal.ultimoResumen;
    final quien = canal.ultimoAutorId == null
        ? ''
        : (canal.ultimoAutorId == yo ? 'Tú' : canal.ultimoAutor?.split(' ').first ?? '');

    return ListTile(
      onTap: () => Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => PantallaCanal(localId: canal.localId),
      )),
      title: Row(
        children: [
          Expanded(
            child: Text(
              canal.nombre,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
            ),
          ),
          if (canal.ultimoEn != null)
            Text(
              cuando(canal.ultimoEn),
              style: const TextStyle(fontSize: 11, color: Tema.gris),
            ),
        ],
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 2),
          Row(
            children: [
              Expanded(
                child: Text(
                  ultimo == null || ultimo.isEmpty
                      ? 'Sin mensajes'
                      : (quien.isEmpty ? ultimo : '$quien: $ultimo'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13),
                ),
              ),
              if (canal.sinLeer > 0)
                Container(
                  margin: const EdgeInsets.only(left: 8),
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: Tema.azul,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    canal.sinLeer > 99 ? '99+' : '${canal.sinLeer}',
                    style: const TextStyle(color: Colors.white, fontSize: 11),
                  ),
                ),
            ],
          ),
          Text(
            canal.canal,
            style: const TextStyle(
              fontSize: 11,
              color: Tema.gris,
              fontFamily: 'monospace',
            ),
          ),
        ],
      ),
    );
  }
}
