import 'package:flutter/material.dart';

import '../app.dart';
import '../nucleo/ajustes.dart';
import '../nucleo/api.dart';
import '../nucleo/tema.dart';

/// Lo primero que se ve al instalar la app: contra qué servidor va.
///
/// Se pregunta una sola vez y se guarda. Antes de darla por buena se llama al
/// servidor, porque una dirección mal escrita que no se comprueba aquí reaparece
/// luego disfrazada de «usuario o contraseña incorrectos».
class PantallaServidor extends StatefulWidget {
  const PantallaServidor({super.key, this.cambiando = false});

  /// Cuando se llega desde «Cambiar servidor» y no desde la instalación, hay
  /// dirección anterior y se puede volver atrás.
  final bool cambiando;

  @override
  State<PantallaServidor> createState() => _PantallaServidorState();
}

class _PantallaServidorState extends State<PantallaServidor> {
  final _direccion = TextEditingController();
  final _formulario = GlobalKey<FormState>();

  bool _comprobando = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.cambiando) _direccion.text = Ajustes.servidor;
  }

  @override
  void dispose() {
    _direccion.dispose();
    super.dispose();
  }

  Future<void> _continuar() async {
    if (!_formulario.currentState!.validate()) return;

    setState(() {
      _comprobando = true;
      _error = null;
    });

    try {
      await Api.comprobarServidor(_direccion.text);
      if (!mounted) return;
      await SesionScope.de(context).guardarServidor(_direccion.text);
      // No hay que navegar: la raíz pasa sola al acceso.
    } on ErrorApi catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _comprobando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: widget.cambiando ? AppBar(title: const Text('Servidor')) : null,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formulario,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (!widget.cambiando) ...[
                      const Icon(Icons.dns_outlined, size: 52, color: Tema.azul),
                      const SizedBox(height: 14),
                      const Text(
                        'Incidencias',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 26, fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 28),
                    ],
                    const Text(
                      '¿Dónde está la aplicación?',
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Escribe la dirección del servidor de incidencias de tu '
                      'organización. Solo hace falta la primera vez.',
                      style: TextStyle(color: Tema.gris, fontSize: 13.5, height: 1.4),
                    ),
                    const SizedBox(height: 20),
                    TextFormField(
                      controller: _direccion,
                      keyboardType: TextInputType.url,
                      autocorrect: false,
                      enableSuggestions: false,
                      autofocus: true,
                      textInputAction: TextInputAction.done,
                      onFieldSubmitted: (_) => _continuar(),
                      decoration: const InputDecoration(
                        labelText: 'Dirección del servidor',
                        // Un ejemplo que se lee como ejemplo. Aquí estuvo el
                        // dominio del grupo, que servía mientras la app se
                        // repartía a mano; en una tienda la instala también
                        // quien tiene su propia instalación, y una dirección
                        // ajena de verdad ahí parece un fallo.
                        hintText: 'incidencias.miempresa.com',
                        prefixIcon: Icon(Icons.link),
                      ),
                      validator: (v) => (v == null || !Ajustes.esValido(v))
                          ? 'Escribe una dirección válida.'
                          : null,
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Si no lleva https:// se le pone solo.',
                      style: TextStyle(color: Tema.gris, fontSize: 12),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Tema.rojo.withOpacity(0.08),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: Tema.rojo.withOpacity(0.3)),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(Icons.error_outline, color: Tema.rojo, size: 20),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                _error!,
                                style: const TextStyle(color: Tema.rojo, fontSize: 13.5),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    const SizedBox(height: 22),
                    FilledButton(
                      onPressed: _comprobando ? null : _continuar,
                      child: _comprobando
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Text('Continuar'),
                    ),
                    if (_comprobando) ...[
                      const SizedBox(height: 10),
                      const Text(
                        'Comprobando que responde…',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Tema.gris, fontSize: 12),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
