import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAddressDto } from './create-address.dto';
import { UpdateAddressDto } from './update-address.dto';

const base = { label: 'Casa', line1: 'Calle 1', lat: 40.82, lng: -73.92 };

const make = (postalCode?: unknown) =>
  plainToInstance(
    CreateAddressDto,
    postalCode === undefined ? { ...base } : { ...base, postalCode },
  );

describe('CreateAddressDto — postalCode', () => {
  it('acepta un ZIP de 5 dígitos', async () => {
    await expect(validate(make('10451'))).resolves.toHaveLength(0);
  });

  it('acepta un ZIP que empieza con cero (Elizabeth NJ es 072xx)', async () => {
    // Si alguien lo tipara como number, el 0 de adelante se pierde y Elizabeth
    // deja de resolver zona. Por eso es string.
    const dto = make('07201');
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.postalCode).toBe('07201');
  });

  it('es opcional — la chincheta del admin y las apps viejas no lo mandan', async () => {
    await expect(validate(make())).resolves.toHaveLength(0);
  });

  it('recorta los espacios que pega el teclado del celular', async () => {
    const dto = make('  10451  ');
    expect(dto.postalCode).toBe('10451');
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rechaza menos o más de 5 dígitos', async () => {
    const corto = await validate(make('1045'));
    expect(corto).toHaveLength(1);
    expect(corto[0].constraints).toHaveProperty('matches');
    await expect(validate(make('104510'))).resolves.toHaveLength(1);
  });

  it('rechaza letras y el ZIP+4 con guión', async () => {
    // "10451-1234" es ZIP+4: válido en el correo, pero acá partiría la
    // resolución de zona por prefijo. Se pide el de 5 y nada más.
    await expect(validate(make('ABCDE'))).resolves.toHaveLength(1);
    await expect(validate(make('10451-1234'))).resolves.toHaveLength(1);
  });

  it('rechaza el string vacío — mandar "" no es lo mismo que no mandarlo', async () => {
    const errors = await validate(make('   '));
    expect(errors).toHaveLength(1);
  });

  it('devuelve el mensaje en castellano que ve el cliente', async () => {
    const errors = await validate(make('1045'));
    expect(errors[0].constraints?.matches).toBe(
      'El código postal debe tener 5 dígitos',
    );
  });
});

describe('UpdateAddressDto — postalCode', () => {
  const makeUpdate = (postalCode: unknown) =>
    plainToInstance(UpdateAddressDto, { postalCode });

  it('hereda la misma validación que Create', async () => {
    await expect(validate(makeUpdate('11201'))).resolves.toHaveLength(0);
    await expect(validate(makeUpdate('112'))).resolves.toHaveLength(1);
  });

  it('acepta un update que no toca el ZIP', async () => {
    await expect(
      validate(plainToInstance(UpdateAddressDto, { label: 'Oficina' })),
    ).resolves.toHaveLength(0);
  });
});

describe('CreateAddressDto — houseNumber', () => {
  const makeHouse = (houseNumber: unknown) =>
    plainToInstance(CreateAddressDto, { ...base, houseNumber });

  it('acepta el número de puerta que escribe el cliente', async () => {
    const dto = makeHouse('1101');
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.houseNumber).toBe('1101');
  });

  it('acepta los formatos raros que SON válidos acá', async () => {
    // "120-05" en Queens es un número de puerta real, no un typo.
    for (const value of ['1101-A', '24 1/2', '120-05']) {
      await expect(validate(makeHouse(value))).resolves.toHaveLength(0);
    }
  });

  it('es opcional — la mayoría de las direcciones se guardan sin él', async () => {
    await expect(
      validate(plainToInstance(CreateAddressDto, { ...base })),
    ).resolves.toHaveLength(0);
  });

  it('recorta espacios', async () => {
    expect(makeHouse('  1101  ').houseNumber).toBe('1101');
  });

  it('rechaza más de 40 caracteres', async () => {
    const errors = await validate(makeHouse('9'.repeat(41)));
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('NO acepta state/city/county del cliente: son hechos del servidor', async () => {
    // `forbidNonWhitelisted` está encendido en el ValidationPipe global, así
    // que un campo que no existe en el DTO es un 400. Lo que se verifica acá es
    // que el DTO efectivamente NO los declara — si alguien los agregara, el
    // cliente podría elegir su propia jurisdicción fiscal.
    const dto = plainToInstance(CreateAddressDto, {
      ...base,
      state: 'NJ',
      city: 'Elizabeth',
      county: 'Union County',
    }) as unknown as Record<string, unknown>;
    expect(Object.keys(new CreateAddressDto())).not.toContain('state');
    expect(dto.state).toBe('NJ'); // plainToInstance no filtra; lo hace el pipe
  });
});
