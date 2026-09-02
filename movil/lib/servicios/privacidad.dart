import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../nucleo/ajustes.dart';
import '../nucleo/tema.dart';

/// La política de privacidad, que la sirve el propio servidor en
/// `/privacidad.html`.
///
/// Vive allí y no dentro de la app a propósito: cada organización que despliega
/// esto responde de la suya, y una copia metida en el binario se quedaría vieja
/// en cuanto alguien la cambiara —además de decir lo que le toca decir a otro—.
/// Aquí solo está el camino para llegar.
///
/// Las dos tiendas piden que se pueda leer **desde dentro de la aplicación**, no
/// solo desde su ficha, así que hay un enlace en la pantalla de acceso —antes
/// de escribir nada— y otro en el menú.
class Privacidad {
  Privacidad._();

  static Uri? get direccion {
    if (!Ajustes.configurado) return null;
    return Uri.tryParse('${Ajustes.servidor}/privacidad.html');
  }

  /// La abre en el navegador del teléfono.
  ///
  /// Si no se puede —un teléfono sin navegador, o sin cobertura— no se deja al
  /// usuario con un botón que no hace nada: se le enseña la dirección y se le
  /// deja copiarla, que es lo único útil que queda por hacer.
  static Future<void> abrir(BuildContext context) async {
    final uri = direccion;
    if (uri == null) {
      _avisar(context, 'Primero hay que indicar la dirección del servidor.');
      return;
    }

    var abierta = false;
    try {
      abierta = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      abierta = false;
    }
    if (abierta || !context.mounted) return;

    await showDialog<void>(
      context: context,
      builder: (dialogo) => AlertDialog(
        title: const Text('Política de privacidad'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'No se ha podido abrir el navegador. La política está en esta '
              'dirección:',
              style: TextStyle(fontSize: 13.5, color: Tema.gris),
            ),
            const SizedBox(height: 12),
            SelectableText(
              uri.toString(),
              style: const TextStyle(fontSize: 13),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogo),
            child: const Text('Cerrar'),
          ),
          FilledButton(
            onPressed: () {
              Clipboard.setData(ClipboardData(text: uri.toString()));
              Navigator.pop(dialogo);
            },
            child: const Text('Copiar'),
          ),
        ],
      ),
    );
  }

  static void _avisar(BuildContext context, String texto) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(texto)));
  }
}

/// El enlace a la política, para ponerlo donde haga falta.
class EnlacePrivacidad extends StatelessWidget {
  const EnlacePrivacidad({super.key});

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: () => Privacidad.abrir(context),
      child: const Text(
        'Política de privacidad',
        style: TextStyle(fontSize: 12, color: Tema.gris),
      ),
    );
  }
}
