import { IsArray, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { RentalStatus } from '../../../entities/rental.entity';

export class ListRentalsQueryDto {
  /**
   * Accepts a single status string (e.g. ?status=active) or multiple values
   * (e.g. ?status=active&status=past_due). The Transform normalises both to
   * an array so the @IsArray / @IsEnum validators always receive a string[].
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (!value) return undefined;
    if (Array.isArray(value)) return value;
    return [value];
  })
  @IsArray()
  @IsEnum(RentalStatus, { each: true })
  status?: RentalStatus[];

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
