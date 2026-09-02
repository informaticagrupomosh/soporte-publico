import 'package:flutter/material.dart';

import '../app.dart';
import '../nucleo/ajustes.dart';
import '../nucleo/api.dart';
import '../nucleo/tema.dart';
import '../servicios/entra.dart';
import '../servicios/privacidad.dart';

/// Correo y contraseña, igual que la web, y debajo la cuenta corporativa si
/// el servidor la tiene configurada. Del todo abajo, el servidor al que apunta
/// la app, plegado: se toca una vez en la vida.
class PantallaAcceso extends StatefulWidget {
  const PantallaAcceso({super.key});

  @override
  State<PantallaAcceso> createState() => _PantallaAccesoState();
}

class _PantallaAccesoState extends State<PantallaAcceso> {
  final _usuario = TextEditingController();
  final _password = TextEditingController();
  final _formulario = GlobalKey<FormState>();

  bool _enviando = false;
  bool _verPassword = false;
  String? _error;

  /// Si este servidor ofrece la entrada con la cuenta corporativa. Mientras no
  /// se sepa, el
  /// botón no está: más vale que aparezca un momento después que enseñar uno
  /// que no lleva a ninguna parte.
  bool _hayOffice = false;

  @override
  void initState() {
    super.initState();
    // La vuelta del navegador puede estar esperando ya: si el enlace arrancó la
    // app, el vale llegó antes que esta pantalla.
    Entra.valePendiente.addListener(_alVolverDeOffice);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _alVolverDeOffice();
      _mirarSiHayOffice();
    });
  }

  @override
  void dispose() {
    Entra.valePendiente.removeListener(_alVolverDeOffice);
    _usuario.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _mirarSiHayOffice() async {
    final hay = await Entra.disponible(SesionScope.de(context).api);
    if (mounted && hay != _hayOffice) setState(() => _hayOffice = hay);
  }

  /// Abre el navegador del teléfono, que es donde está la sesión de Microsoft.
  Future<void> _conOffice() async {
    setState(() {
      _enviando = true;
      _error = null;
    });
    try {
      await Entra.comenzar();
    } on ErrorApi catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    } finally {
      // El navegador se lleva la pantalla; al volver, la app entra sola con el
      // vale, así que aquí no hay nada que esperar.
      if (mounted) setState(() => _enviando = false);
    }
  }

  /// Ha vuelto del navegador con el vale: se cambia por la sesión.
  Future<void> _alVolverDeOffice() async {
    final vale = Entra.valePendiente.value;
    if (vale == null) return;
    // Se retira aquí, antes de nada: es lo que impide que dos avisos seguidos
    // lo canjeen dos veces.
    Entra.valePendiente.value = null;

    setState(() {
      _enviando = true;
      _error = null;
    });
    try {
      await SesionScope.de(context).entrarConOffice(vale);
      // No hay que navegar: la raíz cambia de pantalla al haber sesión.
    } on ErrorApi catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  Future<void> _entrar() async {
    if (!_formulario.currentState!.validate()) return;

    setState(() {
      _enviando = true;
      _error = null;
    });

    try {
      await SesionScope.de(context).entrar(_usuario.text, _password.text);
      // No hay que navegar: la raíz cambia de pantalla al haber sesión.
    } on ErrorApi catch (e) {
      // Aquí caben la espera por intentos fallidos y la cuenta bloqueada; el
      // servidor ya manda el texto explicado, así que se enseña tal cual.
      if (mounted) setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  /// Pide el correo para volver a entrar.
  ///
  /// El servidor contesta lo mismo exista la cuenta o no, así que aquí se
  /// enseña ese mismo texto sin más: decir «ese correo no está» dejaría
  /// averiguar quién tiene cuenta probando direcciones.
  Future<void> _olvidada() async {
    final mensajero = ScaffoldMessenger.of(context);
    final api = SesionScope.de(context).api;

    final correo = await showDialog<String>(
      context: context,
      builder: (_) => _DialogoOlvidada(inicial: _usuario.text.trim()),
    );

    if (correo == null || correo.trim().isEmpty) return;

    try {
      final datos = await api.post('/api/recuperar', {'usuario': correo.trim()});
      final texto = (datos is Map && datos['mensaje'] is String)
          ? datos['mensaje'] as String
          : 'Si esa cuenta existe, le llegará un enlace.';
      mensajero.showSnackBar(SnackBar(content: Text(texto)));
    } on ErrorApi catch (e) {
      mensajero.showSnackBar(
        SnackBar(content: Text(e.mensaje), backgroundColor: Tema.rojo),
      );
    }
  }

  /// Vuelve a la pantalla del servidor. Se avisa porque cambiarlo tira la
  /// sesión: el token no vale en otra máquina.
  Future<void> _cambiarServidor() async {
    final seguro = await showDialog<bool>(
      context: context,
      builder: (dialogo) => AlertDialog(
        title: const Text('Cambiar de servidor'),
        content: Text(
          'La app dejará de usar ${Ajustes.servidorLegible} y tendrás que '
          'volver a entrar.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogo, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogo, true),
            child: const Text('Cambiar'),
          ),
        ],
      ),
    );

    if (seguro != true || !mounted) return;
    await SesionScope.de(context).cambiarDeServidor();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
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
                    const Icon(Icons.warning_amber_rounded, size: 56, color: Tema.azul),
                    const SizedBox(height: 12),
                    const Text(
                      'Incidencias',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 26, fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 32),
                    TextFormField(
                      controller: _usuario,
                      autocorrect: false,
                      enableSuggestions: false,
                      textInputAction: TextInputAction.next,
                      keyboardType: TextInputType.emailAddress,
                      decoration: const InputDecoration(
                        labelText: 'Correo o usuario',
                        prefixIcon: Icon(Icons.person_outline),
                      ),
                      validator: (v) =>
                          (v == null || v.trim().isEmpty) ? 'Escribe tu correo.' : null,
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _password,
                      obscureText: !_verPassword,
                      textInputAction: TextInputAction.done,
                      onFieldSubmitted: (_) => _entrar(),
                      decoration: InputDecoration(
                        labelText: 'Contraseña',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          icon: Icon(_verPassword
                              ? Icons.visibility_off_outlined
                              : Icons.visibility_outlined),
                          onPressed: () => setState(() => _verPassword = !_verPassword),
                        ),
                      ),
                      validator: (v) =>
                          (v == null || v.isEmpty) ? 'Escribe tu contraseña.' : null,
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
                      onPressed: _enviando ? null : _entrar,
                      child: _enviando
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Text('Entrar'),
                    ),
                    if (_hayOffice) ...[
                      const SizedBox(height: 18),
                      const Row(
                        children: [
                          Expanded(child: Divider()),
                          Padding(
                            padding: EdgeInsets.symmetric(horizontal: 10),
                            child: Text('o',
                                style: TextStyle(fontSize: 12, color: Tema.gris)),
                          ),
                          Expanded(child: Divider()),
                        ],
                      ),
                      const SizedBox(height: 14),
                      OutlinedButton.icon(
                        onPressed: _enviando ? null : _conOffice,
                        // Sin el logotipo de Microsoft y sin nombrarlo: la app
                        // se instala desde una tienda y contra cualquier
                        // servidor, y quien la abre no tiene por qué saber qué
                        // producto hay detrás del directorio de su empresa.
                        // Dicho de otro modo, es la cuenta del trabajo.
                        icon: const Icon(Icons.badge_outlined, size: 18),
                        label: const Text('Entrar con la cuenta corporativa'),
                      ),
                      const SizedBox(height: 4),
                    ],
                    const SizedBox(height: 6),
                    TextButton(
                      onPressed: _enviando ? null : _olvidada,
                      child: const Text('He olvidado la contraseña',
                          style: TextStyle(fontSize: 13)),
                    ),
                    const SizedBox(height: 8),
                    // Qué servidor hay puesto, por si alguien duda de si está
                    // mirando el de pruebas.
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.dns_outlined, size: 14, color: Tema.gris),
                        const SizedBox(width: 5),
                        Flexible(
                          child: Text(
                            Ajustes.servidorLegible,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 12, color: Tema.gris),
                          ),
                        ),
                        TextButton(
                          onPressed: _enviando ? null : _cambiarServidor,
                          child: const Text('Cambiar', style: TextStyle(fontSize: 12)),
                        ),
                      ],
                    ),
                    // Las dos tiendas piden que se pueda leer desde dentro de
                    // la app, y este es el sitio: antes de escribir nada.
                    const EnlacePrivacidad(),
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


/// Pide el correo con el que volver a entrar.
///
/// Tiene estado propio para quedarse con su campo de texto hasta que el diálogo
/// se ha ido del todo. Creándolo fuera y soltándolo al volver de `showDialog`
/// se soltaría demasiado pronto: la ventana todavía se está cerrando, el campo
/// sigue montado usándolo, y Flutter aborta al desmontarlo.
class _DialogoOlvidada extends StatefulWidget {
  const _DialogoOlvidada({required this.inicial});

  final String inicial;

  @override
  State<_DialogoOlvidada> createState() => _DialogoOlvidadaState();
}

class _DialogoOlvidadaState extends State<_DialogoOlvidada> {
  late final _control = TextEditingController(text: widget.inicial);

  @override
  void dispose() {
    _control.dispose();
    super.dispose();
  }

  void _enviar() => Navigator.pop(context, _control.text);

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Volver a entrar'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Escribe tu correo y te mandamos un enlace para elegir una '
            'contraseña nueva.',
            style: TextStyle(fontSize: 13.5, color: Tema.gris),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _control,
            autofocus: true,
            autocorrect: false,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'Correo'),
            onSubmitted: (_) => _enviar(),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancelar'),
        ),
        FilledButton(onPressed: _enviar, child: const Text('Enviar')),
      ],
    );
  }
}
